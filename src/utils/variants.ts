import type { RawTikTokItem } from '../types/scraper.js';
import { toOptionalDecimal } from './numbers.js';
import { Prisma } from '@prisma/client';

export interface ExtractedVariant {
  platformSkuId: string;
  name: string | null;
  price: Prisma.Decimal | null;
  stock: number | null;
  /** Lượt bán tích luỹ của riêng biến thể (nếu payload có). */
  soldCount: number | null;
  attributes: Record<string, string> | null;
}

export interface ExtractedVariants {
  variants: ExtractedVariant[];
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  /** Giá đại diện: ưu tiên giá thấp nhất trong biến thể. */
  representativePrice: Prisma.Decimal | null;
  /** Tổng tồn kho của các biến thể (null khi không có dữ liệu). */
  totalStock: number | null;
  /** Tổng lượt bán theo biến thể (null khi không có dữ liệu). */
  totalSold: number | null;
}

const DOT_THOUSANDS_PATTERN = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
const COMMA_THOUSANDS_PATTERN = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const DECIMAL_COMMA_PATTERN = /^\d+,\d{1,2}$/;

/**
 * Parser giá riêng cho biến thể: xử lý cả "199.000", "520,000", "199,000.5", "199000",
 * "199.000đ", number và chuỗi số nguyên lớn (đơn vị VND).
 */
function parsePrice(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? toOptionalDecimal(value) : null;
  if (typeof value === 'bigint') return value > 0n ? toOptionalDecimal(value.toString()) : null;

  const raw = String(value).trim().replace(/[^\d.,-]/g, '');
  if (!raw) return null;

  let normalized = raw;

  if (DOT_THOUSANDS_PATTERN.test(raw)) {
    normalized = raw.replace(/\./g, '').replace(',', '.');
  } else if (COMMA_THOUSANDS_PATTERN.test(raw)) {
    normalized = raw.replace(/,/g, '');
  } else if (DECIMAL_COMMA_PATTERN.test(raw)) {
    normalized = raw.replace(',', '.');
  } else {
    normalized = raw.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? toOptionalDecimal(parsed) : null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function pickArray(...values: unknown[]): unknown[] | null {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

/**
 * Lấy giá trị vô hướng đầu tiên: bỏ qua mảng (một số payload trả price dạng range)
 * nhưng vẫn giữ phần tử đầu nếu đó là số/chuỗi.
 */
function firstScalar(...values: unknown[]): unknown {
  for (const value of values) {
    if (Array.isArray(value)) {
      const scalar = value.find((entry) => typeof entry === 'number' || typeof entry === 'string');
      if (scalar !== undefined) return scalar;
      continue;
    }
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

function toAttributes(entry: Record<string, unknown>): Record<string, string> | null {
  const rawProps =
    pickArray(
      entry.properties,
      entry.skuProps,
      entry.props,
      entry.attributes,
      readPath(entry, 'skuPropertyValues'),
    ) ?? [];

  const attributes: Record<string, string> = {};

  for (const prop of rawProps) {
    if (prop && typeof prop === 'object') {
      const record = prop as Record<string, unknown>;
      const key = pickString(
        record.propName,
        record.prop_name,
        record.name,
        record.key,
        record.propertyName,
      );
      const value = pickString(
        record.propValue,
        record.prop_value,
        record.value,
        record.propertyValue,
      );
      if (key && value) attributes[key] = value;
    } else if (typeof prop === 'string' && prop.includes(':')) {
      const [key, ...rest] = prop.split(':');
      const value = rest.join(':').trim();
      if (key && key.trim() && value) attributes[key.trim()] = value;
    }
  }

  return Object.keys(attributes).length > 0 ? attributes : null;
}

function buildVariantName(attributes: Record<string, string> | null): string | null {
  if (!attributes) return null;
  const parts = Object.values(attributes).filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : null;
}

function toStock(value: unknown): number | null {
  const raw = pickString(value);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pickStock(entry: Record<string, unknown>): number | null {
  return toStock(
    entry.stock ??
      entry.stockCount ??
      entry.quantity ??
      entry.inventory ??
      entry.availableStock ??
      readPath(entry, 'stockInfo.stock') ??
      readPath(entry, 'inventory.stock'),
  );
}

function pickSold(entry: Record<string, unknown>): number | null {
  return toStock(
    entry.soldCount ??
      entry.sold ??
      entry.sales ??
      entry.salesCount ??
      entry.unitsSold ??
      readPath(entry, 'salesInfo.soldCount'),
  );
}

/**
 * Bóc tách toàn bộ mảng biến thể (skus/variants) từ payload thô của Apify.
 * Trả về danh sách biến thể đã chuẩn hoá + khoảng giá min/max.
 *
 * Không bao giờ ném lỗi: payload lạ/rỗng chỉ trả về danh sách rỗng.
 */
export function extractVariants(item: RawTikTokItem): ExtractedVariants {
  const rawList =
    pickArray(
      readPath(item, 'productInfo.skus'),
      readPath(item, 'product.skus'),
      readPath(item, 'item.skus'),
      readPath(item, 'skus'),
      readPath(item, 'productInfo.variants'),
      readPath(item, 'product.variants'),
      readPath(item, 'variants'),
      readPath(item, 'skuList'),
    ) ?? [];

  const variants: ExtractedVariant[] = [];
  const seen = new Set<string>();

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const rawPrice = firstScalar(
      entry.price,
      entry.salePrice,
      entry.sale_price,
      entry.currentPrice,
      readPath(entry, 'priceInfo.price'),
      readPath(entry, 'priceInfo.salePrice'),
    );
    const price = parsePrice(rawPrice);

    const attributes = toAttributes(entry);

    const name =
      pickString(entry.name, entry.skuName, entry.sku_name, entry.title) ?? buildVariantName(attributes);

    const platformSkuId =
      pickString(
        entry.skuId,
        entry.sku_id,
        entry.id,
        entry.skuCode,
        entry.sku_code,
        readPath(entry, 'skuId'),
      ) ?? null;

    // Never fabricate source SKU identifiers from display names.
    if (!platformSkuId) continue;
    const stableId = platformSkuId;

    if (seen.has(stableId)) continue;
    seen.add(stableId);

    variants.push({
      platformSkuId: stableId,
      name,
      price,
      stock: pickStock(entry),
      soldCount: pickSold(entry),
      attributes,
    });
  }

  let minPrice: Prisma.Decimal | null = null;
  let maxPrice: Prisma.Decimal | null = null;
  let totalStock: number | null = null;
  let totalSold: number | null = null;

  for (const variant of variants) {
    if (variant.price) {
      if (minPrice === null || variant.price.lt(minPrice)) minPrice = variant.price;
      if (maxPrice === null || variant.price.gt(maxPrice)) maxPrice = variant.price;
    }
    if (variant.stock !== null) totalStock = (totalStock ?? 0) + variant.stock;
    if (variant.soldCount !== null) totalSold = (totalSold ?? 0) + variant.soldCount;
  }

  return {
    variants: variants.slice(0, 200),
    minPrice,
    maxPrice,
    representativePrice: minPrice,
    totalStock,
    totalSold,
  };
}



