import { Prisma } from '@prisma/client';
import { toOptionalBigInt, toOptionalNumber } from './numbers.js';

const MONEY_THOUSANDS_DOT = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/;
const MONEY_THOUSANDS_COMMA = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
const MONEY_DECIMAL_COMMA = /^\d+,\d{1,2}$/;

/**
 * Parser tiền tệ an toàn cho payload TikTok Shop.
 * Hỗ trợ object `{ value, currency }`, number, bigint và string định dạng VN/US.
 * Trả về null thay vì ném lỗi để vòng lặp cào 24/7 không bị gián đoạn.
 */
export function toOptionalMoney(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return toOptionalMoney(record.value ?? record.amount ?? record.price ?? record.raw);
  }

  if (typeof value === 'bigint') {
    return value > 0n ? decimalFromString(value.toString()) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? decimalFromString(String(value)) : null;
  }

  const raw = String(value).trim().replace(/[^\d.,-]/g, '');
  if (!raw) return null;

  let normalized = raw;
  if (MONEY_THOUSANDS_DOT.test(raw)) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (MONEY_THOUSANDS_COMMA.test(raw)) normalized = raw.replace(/,/g, '');
  else if (MONEY_DECIMAL_COMMA.test(raw)) normalized = raw.replace(',', '.');
  else normalized = raw.replace(/,/g, '');

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return decimalFromString(String(parsed));
}

function decimalFromString(value: string): Prisma.Decimal | null {
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

/** Lấy mã tiền tệ từ `{ value, currency }` hoặc field currency cấp cao hơn. */
export function readCurrency(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && /^[A-Za-z]{3}$/.test(value.trim())) {
      return value.trim().toUpperCase();
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const currency = (value as Record<string, unknown>).currency;
      if (typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency.trim())) {
        return currency.trim().toUpperCase();
      }
    }
  }
  return null;
}

/** Số nguyên không âm (tồn kho, số bán, review count). */
export function toOptionalCount(value: unknown): number | null {
  const parsed = toOptionalBigInt(value);
  if (parsed === null) return null;
  if (parsed < 0n) return null;
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Number(parsed);
}

/** Chuỗi an toàn: cắt khoảng trắng, trả null nếu rỗng. */
export function pickText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Đọc đường dẫn lồng nhau `a.b.c` trên object không xác định kiểu. */
export function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** Điểm đánh giá (0-5) — bỏ giá trị ngoài khoảng hợp lệ. */
export function toOptionalRating(value: unknown): Prisma.Decimal | null {
  const parsed = toOptionalNumber(value);
  if (parsed === null || parsed < 0 || parsed > 5) return null;
  return decimalFromString(parsed.toFixed(2));
}
