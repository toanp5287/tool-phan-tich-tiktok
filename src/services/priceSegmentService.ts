import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { DEFAULT_CATEGORY } from '../config/taxonomy.js';
import type {
  PriceSegmentCode,
  PriceSegmentDefinition,
  PriceSegmentFilterInput,
  PriceSegmentOverview,
  PriceSegmentProductItem,
  PriceSegmentSummary,
  PriceSegmentVariantItem,
  ProductVariantsDetail,
} from '../types/priceSegment.js';
import { AppError } from '../utils/errors.js';
import {
  bigIntToNumber,
  decimalToNumber,
  percentChange,
  roundTo,
  safeDivide,
} from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';

/* ------------------------------------------------------------------ */
/* Định nghĩa các phân khúc giá chuẩn                                  */
/* ------------------------------------------------------------------ */

export const PRICE_SEGMENTS: readonly PriceSegmentDefinition[] = [
  {
    code: 'under-100k',
    label: 'Dưới 100.000 ₫',
    shortLabel: 'Dưới 100k',
    minPrice: 0,
    maxPrice: 100_000,
  },
  {
    code: '100k-300k',
    label: '100.000 ₫ – 300.000 ₫',
    shortLabel: '100k – 300k',
    minPrice: 100_000,
    maxPrice: 300_000,
  },
  {
    code: '300k-500k',
    label: '300.000 ₫ – 500.000 ₫',
    shortLabel: '300k – 500k',
    minPrice: 300_000,
    maxPrice: 500_000,
  },
  {
    code: 'over-500k',
    label: 'Trên 500.000 ₫',
    shortLabel: 'Trên 500k',
    minPrice: 500_000,
    maxPrice: null,
  },
] as const;

const VALID_SEGMENT_CODES = new Set<string>(PRICE_SEGMENTS.map((segment) => segment.code));

export function isPriceSegmentCode(value: string): value is PriceSegmentCode {
  return VALID_SEGMENT_CODES.has(value);
}

export function parseSegmentCodes(raw: unknown): PriceSegmentCode[] {
  const tokens: string[] = Array.isArray(raw)
    ? raw.flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
    : typeof raw === 'string'
      ? raw.split(',')
      : [];

  const result: PriceSegmentCode[] = [];
  const seen = new Set<PriceSegmentCode>();

  for (const token of tokens) {
    const normalized = token.trim().toLowerCase();
    if (isPriceSegmentCode(normalized) && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Helpers phân loại khoảng giá                                        */
/* ------------------------------------------------------------------ */

export function classifySinglePrice(price: number): PriceSegmentCode {
  if (!Number.isFinite(price) || price < 100_000) return 'under-100k';
  if (price < 300_000) return '100k-300k';
  if (price <= 500_000) return '300k-500k';
  return 'over-500k';
}

function rangeMatchesSegment(minPrice: number, maxPrice: number, segment: PriceSegmentDefinition): boolean {
  const low = Math.min(minPrice, maxPrice);
  const high = Math.max(minPrice, maxPrice);

  if (segment.code === 'under-100k') {
    return low < 100_000;
  }
  if (segment.code === '100k-300k') {
    return high >= 100_000 && low < 300_000;
  }
  if (segment.code === '300k-500k') {
    return high >= 300_000 && low <= 500_000;
  }
  return high > 500_000;
}

export function resolveMatchedSegments(
  minPrice: number,
  maxPrice: number,
  variantPrices: readonly number[],
): PriceSegmentCode[] {
  const validVariantPrices = variantPrices.filter((price) => Number.isFinite(price) && price > 0);

  if (validVariantPrices.length > 0) {
    const matched = new Set<PriceSegmentCode>();
    for (const price of validVariantPrices) {
      matched.add(classifySinglePrice(price));
    }
    return PRICE_SEGMENTS.map((segment) => segment.code).filter((code) => matched.has(code));
  }

  return PRICE_SEGMENTS.filter((segment) => rangeMatchesSegment(minPrice, maxPrice, segment)).map(
    (segment) => segment.code,
  );
}

function formatVndShort(price: number): string {
  const amount = Math.max(0, Math.round(price));
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
}

export function buildPriceRangeLabel(minPrice: number, maxPrice: number): string {
  const low = Math.min(minPrice, maxPrice);
  const high = Math.max(minPrice, maxPrice);
  if (high <= 0) return '0 ₫';
  if (Math.abs(high - low) < 1) return formatVndShort(low);
  return `${formatVndShort(low)} – ${formatVndShort(high)}`;
}

function readAttributes(value: Prisma.JsonValue | null): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim()) {
      output[key] = entry.trim();
    } else if (typeof entry === 'number' && Number.isFinite(entry)) {
      output[key] = String(entry);
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

/* ------------------------------------------------------------------ */
/* Nạp dữ liệu sản phẩm kèm khoảng giá & biến thể                      */
/* ------------------------------------------------------------------ */

interface BaseWhereOptions {
  category?: string;
  subCategory?: string;
  search?: string;
  shopId?: number;
  onlyMultiVariant?: boolean;
}

function buildBaseProductWhere(options: BaseWhereOptions): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {};

  if (options.category) {
    where.category = { equals: options.category, mode: 'insensitive' };
  }
  if (options.subCategory) {
    where.subCategory = { equals: options.subCategory, mode: 'insensitive' };
  }
  if (options.shopId) {
    where.productShops = { some: { shopId: options.shopId, isActive: true } };
  }
  if (options.onlyMultiVariant) {
    where.OR = [{ variantCount: { gt: 1 } }];
  }
  if (options.search) {
    where.AND = [
      {
        OR: [
          { title: { contains: options.search, mode: 'insensitive' } },
          { description: { contains: options.search, mode: 'insensitive' } },
          { platformProductId: { equals: options.search } },
          { productShops: { some: { shop: { name: { contains: options.search, mode: 'insensitive' } } } } },
        ],
      },
    ];
  }

  return where;
}

async function fetchEnrichedProducts(options: BaseWhereOptions): Promise<PriceSegmentProductItem[]> {
  const where = buildBaseProductWhere(options);

  const rows = await prisma.product.findMany({
    where,
    include: {
      variants: {
        orderBy: [{ price: 'asc' }, { id: 'asc' }],
      },
      snapshots: {
        orderBy: { capturedAt: 'desc' },
        take: 2,
      },
      productShops: {
        where: { isActive: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 1,
        include: {
          shop: { select: { id: true, name: true, avatarUrl: true } },
          snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
        },
      },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
  });

  return rows.map((product) => {
    const latest = product.snapshots[0];
    const previous = product.snapshots[1];
    const tracking = product.productShops[0];
    const trackingSnapshot = tracking?.snapshots[0];

    const snapshotPrice =
      decimalToNumber(latest?.price) ?? decimalToNumber(trackingSnapshot?.price) ?? 0;

    const variantItems: PriceSegmentVariantItem[] = product.variants.map((variant) => {
      const variantPrice = decimalToNumber(variant.price);
      return {
        id: variant.id,
        platformSkuId: variant.platformSkuId,
        name: variant.name,
        price: variantPrice,
        stock: variant.stock,
        attributes: readAttributes(variant.attributes),
        segmentCode: variantPrice !== null ? classifySinglePrice(variantPrice) : null,
        lastSeenAt: toIso(variant.lastSeenAt),
      };
    });

    const variantPrices = variantItems
      .map((variant) => variant.price)
      .filter((price): price is number => price !== null && price > 0);

    const dbMinPrice = decimalToNumber(product.minPrice);
    const dbMaxPrice = decimalToNumber(product.maxPrice);

    const computedMin =
      variantPrices.length > 0
        ? Math.min(...variantPrices)
        : dbMinPrice ?? (snapshotPrice > 0 ? snapshotPrice : 0);

    const computedMax =
      variantPrices.length > 0
        ? Math.max(...variantPrices)
        : dbMaxPrice ?? computedMin;

    const minPrice = Math.min(computedMin, computedMax);
    const maxPrice = Math.max(computedMin, computedMax);
    const representativePrice = minPrice > 0 ? minPrice : snapshotPrice;

    const matchedSegments = resolveMatchedSegments(minPrice, maxPrice, variantPrices);
    const primarySegment = classifySinglePrice(representativePrice);

    const sales =
      bigIntToNumber(latest?.soldCountTotal) ??
      bigIntToNumber(trackingSnapshot?.soldCountTotal) ??
      0;
    const previousSales = bigIntToNumber(previous?.soldCountTotal) ?? sales;
    const gmv =
      decimalToNumber(latest?.gmvTotal) ??
      decimalToNumber(trackingSnapshot?.gmvTotal) ??
      0;

    const variantCount = Math.max(product.variantCount, variantItems.length);
    const hasPriceRange = maxPrice - minPrice >= 1;

    return {
      id: product.id,
      platformProductId: product.platformProductId,
      title: product.title,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      category: product.category,
      subCategory: product.subCategory,
      shopId: tracking?.shop.id ?? null,
      shopName: tracking?.shop.name ?? 'TikTok Shop',
      shopAvatarUrl: tracking?.shop.avatarUrl ?? null,
      price: representativePrice,
      minPrice,
      maxPrice,
      hasPriceRange,
      priceRangeLabel: buildPriceRangeLabel(minPrice, maxPrice),
      variantCount,
      matchedSegments,
      primarySegment,
      sales,
      gmv,
      views: bigIntToNumber(latest?.playCount) ?? 0,
      likes: bigIntToNumber(latest?.diggCount) ?? 0,
      shares: bigIntToNumber(latest?.shareCount) ?? 0,
      growthRate: percentChange(sales, previousSales),
      lastSeenAt: toIso(product.lastSeenAt),
      capturedAt: toIso(latest?.capturedAt),
      variants: variantItems,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Bộ lọc theo phân khúc và khoảng giá tuỳ chỉnh                       */
/* ------------------------------------------------------------------ */

function matchesPriceFilter(
  item: PriceSegmentProductItem,
  segments: readonly PriceSegmentCode[],
  minPrice?: number | null,
  maxPrice?: number | null,
): boolean {
  if (segments.length > 0) {
    const hit = segments.some((code) => item.matchedSegments.includes(code));
    if (!hit) return false;
  }

  if (typeof minPrice === 'number' && Number.isFinite(minPrice) && minPrice > 0) {
    if (item.maxPrice < minPrice) return false;
  }

  if (typeof maxPrice === 'number' && Number.isFinite(maxPrice) && maxPrice > 0) {
    if (item.minPrice > maxPrice) return false;
  }

  return true;
}

const SORT_EXTRACTORS: Record<
  NonNullable<PriceSegmentFilterInput['sortBy']>,
  (item: PriceSegmentProductItem) => number
> = {
  gmv: (item) => item.gmv,
  sales: (item) => item.sales,
  views: (item) => item.views,
  price: (item) => item.price,
  minPrice: (item) => item.minPrice,
  maxPrice: (item) => item.maxPrice,
  variants: (item) => item.variantCount,
  recent: (item) => (item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0),
};

/* ------------------------------------------------------------------ */
/* API công khai                                                       */
/* ------------------------------------------------------------------ */

/**
 * GET /api/price-segments/overview
 * Tổng hợp phân bổ sản phẩm, GMV, sản lượng và ngành hàng theo 4 phân khúc giá.
 */
export async function getPriceSegmentOverview(options: {
  category?: string;
  subCategory?: string;
}): Promise<PriceSegmentOverview> {
  const items = await fetchEnrichedProducts({
    category: options.category,
    subCategory: options.subCategory,
  });

  const totalProducts = items.length;
  const multiVariantProducts = items.filter((item) => item.variantCount > 1 || item.hasPriceRange).length;
  const totalGmv = items.reduce((sum, item) => sum + item.gmv, 0);
  const totalSales = items.reduce((sum, item) => sum + item.sales, 0);
  const totalViews = items.reduce((sum, item) => sum + item.views, 0);

  const segments: PriceSegmentSummary[] = PRICE_SEGMENTS.map((definition) => {
    const matched = items.filter((item) => item.matchedSegments.includes(definition.code));
    const shops = new Set<number>();
    let sales = 0;
    let gmv = 0;
    let views = 0;
    let priceSum = 0;
    let priceCount = 0;
    let variantCount = 0;

    for (const item of matched) {
      sales += item.sales;
      gmv += item.gmv;
      views += item.views;
      variantCount += Math.max(1, item.variantCount);
      if (item.price > 0) {
        priceSum += item.price;
        priceCount += 1;
      }
      if (item.shopId !== null) shops.add(item.shopId);
    }

    return {
      code: definition.code,
      label: definition.label,
      shortLabel: definition.shortLabel,
      minPrice: definition.minPrice,
      maxPrice: definition.maxPrice,
      productCount: matched.length,
      variantCount,
      shopCount: shops.size,
      totalSales: sales,
      totalGmv: roundTo(gmv, 0),
      totalViews: views,
      avgPrice: priceCount > 0 ? roundTo(safeDivide(priceSum, priceCount), 0) : 0,
      shareOfProducts: totalProducts > 0 ? roundTo((matched.length / totalProducts) * 100, 2) : 0,
      shareOfGmv: totalGmv > 0 ? roundTo((gmv / totalGmv) * 100, 2) : 0,
    };
  });

  const categoryMap = new Map<
    string,
    {
      totalProducts: number;
      totalGmv: number;
      bySegment: Record<PriceSegmentCode, { products: number; gmv: number }>;
    }
  >();

  for (const item of items) {
    const category = item.category?.trim() || DEFAULT_CATEGORY;
    let entry = categoryMap.get(category);
    if (!entry) {
      entry = {
        totalProducts: 0,
        totalGmv: 0,
        bySegment: {
          'under-100k': { products: 0, gmv: 0 },
          '100k-300k': { products: 0, gmv: 0 },
          '300k-500k': { products: 0, gmv: 0 },
          'over-500k': { products: 0, gmv: 0 },
        },
      };
      categoryMap.set(category, entry);
    }

    entry.totalProducts += 1;
    entry.totalGmv += item.gmv;

    for (const code of item.matchedSegments) {
      const bucket = entry.bySegment[code];
      bucket.products += 1;
      bucket.gmv = roundTo(bucket.gmv + item.gmv, 0);
    }
  }

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, value]) => ({
      category,
      totalProducts: value.totalProducts,
      totalGmv: roundTo(value.totalGmv, 0),
      bySegment: value.bySegment,
    }))
    .sort((a, b) => b.totalGmv - a.totalGmv);

  return {
    totalProducts,
    multiVariantProducts,
    totalGmv: roundTo(totalGmv, 0),
    totalSales,
    totalViews,
    segments,
    categoryBreakdown,
  };
}

/**
 * GET /api/price-segments/products
 * Lọc danh sách sản phẩm theo một hoặc nhiều phân khúc giá + khoảng giá tuỳ chỉnh.
 */
export async function listProductsByPriceSegment(
  filters: PriceSegmentFilterInput,
): Promise<{ items: PriceSegmentProductItem[]; total: number }> {
  const allItems = await fetchEnrichedProducts({
    category: filters.category,
    subCategory: filters.subCategory,
    search: filters.search,
    shopId: filters.shopId,
    onlyMultiVariant: filters.onlyMultiVariant,
  });

  const segments = filters.segments ?? [];
  const filtered = allItems.filter((item) =>
    matchesPriceFilter(item, segments, filters.minPrice, filters.maxPrice),
  );

  const sortBy = filters.sortBy ?? 'gmv';
  const extractor = SORT_EXTRACTORS[sortBy] ?? SORT_EXTRACTORS.gmv;
  const direction = filters.sortDir === 'asc' ? 1 : -1;

  const sorted = [...filtered].sort((a, b) => (extractor(a) - extractor(b)) * direction);
  const start = (filters.page - 1) * filters.pageSize;
  const paged = sorted.slice(start, start + filters.pageSize);

  return { items: paged, total: filtered.length };
}

/**
 * GET /api/price-segments/products/:id/variants
 * Chi tiết biến thể (SKUs) và khoảng giá của một sản phẩm.
 */
export async function getProductVariantsDetail(productId: number): Promise<ProductVariantsDetail> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }] },
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
    },
  });

  if (!product) {
    throw AppError.notFound(`Không tìm thấy sản phẩm #${productId}`);
  }

  const snapshotPrice = decimalToNumber(product.snapshots[0]?.price) ?? 0;
  const variants: PriceSegmentVariantItem[] = product.variants.map((variant) => {
    const price = decimalToNumber(variant.price);
    return {
      id: variant.id,
      platformSkuId: variant.platformSkuId,
      name: variant.name,
      price,
      stock: variant.stock,
      attributes: readAttributes(variant.attributes),
      segmentCode: price !== null ? classifySinglePrice(price) : null,
      lastSeenAt: toIso(variant.lastSeenAt),
    };
  });

  const variantPrices = variants
    .map((variant) => variant.price)
    .filter((price): price is number => price !== null && price > 0);

  const minPrice =
    variantPrices.length > 0
      ? Math.min(...variantPrices)
      : decimalToNumber(product.minPrice) ?? snapshotPrice;

  const maxPrice =
    variantPrices.length > 0
      ? Math.max(...variantPrices)
      : decimalToNumber(product.maxPrice) ?? minPrice;

  const matchedSegments = resolveMatchedSegments(minPrice, maxPrice, variantPrices);

  return {
    productId: product.id,
    platformProductId: product.platformProductId,
    title: product.title,
    category: product.category,
    subCategory: product.subCategory,
    minPrice,
    maxPrice,
    hasPriceRange: maxPrice - minPrice >= 1,
    priceRangeLabel: buildPriceRangeLabel(minPrice, maxPrice),
    variantCount: Math.max(product.variantCount, variants.length),
    matchedSegments,
    variants,
  };
}
