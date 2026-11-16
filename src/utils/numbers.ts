import { Prisma } from '@prisma/client';

const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Chuyển giá trị bất kỳ (string "1.234", "1,234.5", "12.3K", number, bigint) sang number hữu hạn.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = parseLooseNumber(value);
  return parsed === null ? fallback : parsed;
}

export function toOptionalNumber(value: unknown): number | null {
  return parseLooseNumber(value);
}

function parseLooseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);

  const raw = String(value).trim();
  if (!raw) return null;

  const suffix = raw.slice(-1).toUpperCase();
  const multiplier = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : suffix === 'B' ? 1_000_000_000 : 1;
  const numericPart = multiplier === 1 ? raw : raw.slice(0, -1);

  const cleaned = numericPart
    .replace(/[^\d.,-]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/,/g, '.');

  if (!NUMBER_PATTERN.test(cleaned)) return null;

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parsed * multiplier;
}

export function toBigIntSafe(value: unknown, fallback = 0n): bigint {
  return toOptionalBigInt(value) ?? fallback;
}

export function toOptionalBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed);
      } catch {
        return null;
      }
    }
  }

  const asNumber = parseLooseNumber(value);
  if (asNumber === null || !Number.isFinite(asNumber)) return null;
  return BigInt(Math.trunc(asNumber));
}

export function toOptionalDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Prisma.Decimal) return value;

  const asNumber = parseLooseNumber(value);
  if (asNumber === null || !Number.isFinite(asNumber)) return null;

  try {
    return new Prisma.Decimal(asNumber);
  } catch {
    return null;
  }
}

export function decimalToNumber(value: Prisma.Decimal | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function bigIntToNumber(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    return Number(value);
  }
  return null;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = parseLooseNumber(value);
  if (parsed === null) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  return numerator / denominator;
}

export function roundTo(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function percentChange(current: number, previous: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return roundTo(((current - previous) / Math.abs(previous)) * 100, 2);
}
