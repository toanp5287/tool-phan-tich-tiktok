import type { Prisma } from '@prisma/client';
import { bigIntToNumber, decimalToNumber } from './numbers.js';

type JsonLike = Record<string, unknown> | unknown[] | unknown;

/**
 * Chuyển BigInt về number/string để JSON.stringify không ném TypeError.
 * Giá trị vượt ngưỡng an toàn được giữ dạng string.
 */
export function serializeValue(value: JsonLike): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return bigIntToNumber(value) ?? value.toString();
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);

  if (typeof value === 'object') {
    const decimal = asDecimal(value);
    if (decimal !== null) return decimal;

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = serializeValue(nested as JsonLike);
    }
    return output;
  }

  return String(value);
}

function asDecimal(value: object): number | null {
  const candidate = value as { toString?: () => string; constructor?: { name?: string } };
  const isDecimal = candidate.constructor?.name === 'Decimal' || candidate.constructor?.name === 'Decimal2';
  if (!isDecimal) return null;
  return decimalToNumber(value as Prisma.Decimal);
}

export function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

export function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key as keyof T] = value as T[keyof T];
  }
  return output;
}
