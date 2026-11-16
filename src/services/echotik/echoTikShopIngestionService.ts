import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import prisma from '../../config/db.js';
import { isEchoTikEnabled } from '../../config/env.js';
import { getEchoTikClient } from './echoTikClient.js';

export interface EchoTikShopIngestionResult {
  received: number;
  created: number;
  skipped: number;
  failed: number;
  apiRequestsUsed: number;
  rawResponsePath: string;
  errors: string[];
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function requiredText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function optionalInteger(value: unknown, field: string): bigint | number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${field} is not an integer value`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) throw new Error(`${field} is not a non-negative integer`);
  const parsed = BigInt(text);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed;
}

function optionalRating(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error('rating is not numeric');
  }
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error('rating is not a finite decimal');
  }
  return text;
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  const object = asObject(value);
  if (!object) return value;

  const redacted: JsonObject = {};
  for (const [key, item] of Object.entries(object)) {
    redacted[key] = /password|authorization|access.?token|api.?key|secret/i.test(key)
      ? '[REDACTED]'
      : redactSecrets(item);
  }
  return redacted;
}

function extractSellerRows(response: unknown): JsonObject[] {
  const envelope = asObject(response);
  if (!envelope || !Array.isArray(envelope.data)) {
    throw new Error('Seller List response does not contain a data array');
  }
  if (envelope.code !== undefined && ![0, 200, '0', '200'].includes(envelope.code as never)) {
    throw new Error(`Seller List returned API code ${String(envelope.code)}`);
  }

  return envelope.data.map((row, index) => {
    const object = asObject(row);
    if (!object) throw new Error(`Seller List row ${index + 1} is not an object`);
    return object;
  });
}

/** Calls Seller List once, stores its response, then creates only missing shops. */
export async function ingestEchoTikShops(): Promise<EchoTikShopIngestionResult> {
  if (!isEchoTikEnabled()) {
    throw new Error('EchoTik is not enabled or Basic Auth credentials are not configured');
  }

  const response = await getEchoTikClient().getSellerList(1, 10, 'VN');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rawResponsePath = resolve(process.cwd(), 'data', 'echotik', `seller-list-${timestamp}.json`);

  await mkdir(dirname(rawResponsePath), { recursive: true });
  await writeFile(rawResponsePath, `${JSON.stringify(redactSecrets(response), null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });

  const rows = extractSellerRows(response);
  if (rows.length > 10) throw new Error(`Seller List exceeded the approved 10-shop limit (${rows.length})`);

  const result: EchoTikShopIngestionResult = {
    received: rows.length,
    created: 0,
    skipped: 0,
    failed: 0,
    apiRequestsUsed: 1,
    rawResponsePath: rawResponsePath.replace(`${process.cwd()}\\`, ''),
    errors: [],
  };

  for (const [index, row] of rows.entries()) {
    try {
      const platformShopId = requiredText(row.seller_id);
      const name = requiredText(row.seller_name);
      const region = requiredText(row.region);
      if (!platformShopId || !name || !region) {
        throw new Error('required seller_id, seller_name, or region is missing');
      }
      if (region.toUpperCase() !== 'VN') throw new Error('region is not VN');

      const followerCount = optionalInteger(row.followers_count, 'followers_count');
      const rating = optionalRating(row.rating);
      const ratingCount = optionalInteger(row.review_count, 'review_count');
      const productCount = optionalInteger(row.total_crawl_product_cnt, 'total_crawl_product_cnt');
      if (typeof productCount === 'bigint' || (productCount !== null && productCount > 2_147_483_647)) {
        throw new Error('total_crawl_product_cnt exceeds Prisma Int range');
      }

      const existing = await prisma.shop.findUnique({
        where: { platformShopId_source: { platformShopId, source: 'echotik' } },
        select: { id: true },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      await prisma.shop.create({
        data: {
          platformShopId,
          source: 'echotik',
          name,
          shopUrl: requiredText(row.seller_link),
          region,
          followerCount: followerCount === null ? null : BigInt(followerCount),
          ratingScore: rating,
          ratingCount: ratingCount === null ? null : BigInt(ratingCount),
          productCount: productCount ?? 0,
        },
      });
      result.created += 1;
    } catch (error) {
      if (asObject(error)?.code === 'P2002') {
        result.skipped += 1;
        continue;
      }
      result.failed += 1;
      result.errors.push(`row ${index + 1}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return result;
}
