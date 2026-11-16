import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import prisma from '../../config/db.js';
import { Prisma } from '@prisma/client';
import { getActiveEchoTikRequestBudget } from './echoTikRequestBudget.js';
import { hasNextEchoTikPage } from './echoTikSyncRules.js';
import { getEchoTikClient } from './echoTikClient.js';
import { createLogger } from '../../utils/logger.js';
import { getEchoTikCachedResponse, getNextEchoTikPage, isBeyondEchoTikTerminalPage, isEchoTikPageComplete, markEchoTikPageComplete, saveEchoTikRawResponse } from './echoTikSyncState.js';

const logger = createLogger('echotik-shop-full-ingestion');

export interface ShopIngestionResult {
  received: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  apiRequestsUsed: number;
  rawResponsePath: string;
  errors: string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function optionalDecimal(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`${field} is not numeric`);
  }
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    throw new Error(`${field} is not a finite decimal`);
  }
  return text;
}

function extractSellerRows(response: unknown): Record<string, unknown>[] {
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

/**
 * Ingest all EchoTik shops with full pagination
 * Does NOT limit to 10 shops — fetches all available
 */
export async function ingestEchoTikShopsFullDataset(
  maxPages: number = 50,
  pageSize: number = 10,
): Promise<ShopIngestionResult> {
  if (pageSize !== 10) throw new Error('EchoTik shop ingestion requires page_size=10');
  const result: ShopIngestionResult = {
    received: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    apiRequestsUsed: 0,
    rawResponsePath: '',
    errors: [],
  };

  try {
    const client = getEchoTikClient();

    const firstPage = await getNextEchoTikPage('shop-list', pageSize);
    for (let page = firstPage; page < firstPage + maxPages; page++) {
      try {
        if (getActiveEchoTikRequestBudget()?.remaining === 0) break;
        const pageKey = `shop-list:${page}:${pageSize}`;
        if (await isBeyondEchoTikTerminalPage('shop-list', page, pageSize)) break;
        if (await isEchoTikPageComplete(pageKey)) continue;

        logger.info(`Fetching shop page ${page}/${maxPages} (size=${pageSize})...`);
        
        const cached = await getEchoTikCachedResponse(pageKey);
        const budget = getActiveEchoTikRequestBudget();
        const usedBefore = budget?.used ?? 0;
        let response: Record<string, unknown>;
        try {
          response = (cached ?? await client.getSellerList(page, pageSize, 'VN')) as Record<string, unknown>;
        } finally {
          if (cached === null && budget && budget.used > usedBefore) result.apiRequestsUsed += budget.used - usedBefore;
        }
        if (cached === null && !budget) result.apiRequestsUsed += 1;

        // Save raw response for debugging
        if (cached === null) result.rawResponsePath = await saveEchoTikRawResponse('seller-list', page, response, pageKey);

        const rows = extractSellerRows(response);
        if (rows.length === 0) {
          logger.info(`Page ${page}: No more sellers returned, stopping pagination`);
          await markEchoTikPageComplete(pageKey, true);
          break;
        }

        result.received += rows.length;
        logger.info(`Page ${page}: Processing ${rows.length} shops...`);

        // Process each seller
        for (const [index, row] of rows.entries()) {
          try {
            const platformShopId = requiredText(row.seller_id);
            const name = requiredText(row.seller_name);
            const region = requiredText(row.region);

            if (!platformShopId || !name || !region) {
              throw new Error('required seller_id, seller_name, or region is missing');
            }

            if (region.toUpperCase() !== 'VN') {
              throw new Error('region is not VN');
            }

            const followerCount = optionalInteger(row.followers_count, 'followers_count');
            const ratingScore = optionalDecimal(row.rating, 'rating');
            const ratingCount = optionalInteger(row.review_count, 'review_count');
            const productCount = optionalInteger(
              row.total_crawl_product_cnt,
              'total_crawl_product_cnt',
            );

            if (typeof productCount === 'bigint' || (productCount !== null && productCount > 2147483647)) {
              throw new Error('total_crawl_product_cnt exceeds Prisma Int range');
            }

            // Store EchoTik metadata
            const echotikMetadata = {
              response_rate: row.response_rate ?? null,
              positive_feedback_rate: row.positive_feedback_rate ?? null,
              delivery_rate: row.delivery_rate ?? null,
              shop_type: row.shop_type ?? null,
              shop_identity_label: row.shop_identity_label ?? null,
              sec_uid: row.sec_uid ?? null,
              category_id: row.category_id ?? null,
              category_l2_id: row.category_l2_id ?? null,
              category_l3_id: row.category_l3_id ?? null,
              from_flag: row.from_flag ?? null,
              sales_flag: row.sales_flag ?? null,
              sales_trend_flag: row.sales_trend_flag ?? null,
              first_crawl_dt: row.first_crawl_dt ?? null,
              total_ifl_cnt: row.total_ifl_cnt ?? null,
              spu_avg_price: row.spu_avg_price ?? null,
            };

            // Find existing shop with same platformShopId + source
            const outcome = await prisma.$transaction(async (tx) => {
              const existing = await tx.shop.findUnique({
                where: { platformShopId_source: { platformShopId, source: 'echotik' } },
                select: { id: true },
              });
              const shop = await tx.shop.upsert({
                where: { platformShopId_source: { platformShopId, source: 'echotik' } },
                create: {
                  platformShopId, source: 'echotik', name,
                  shopUrl: requiredText(row.seller_link), region,
                  followerCount: followerCount === null ? null : BigInt(followerCount),
                  ratingScore, ratingCount: ratingCount === null ? null : BigInt(ratingCount),
                  productCount: productCount ?? 0, echotikMetadata,
                },
                update: {
                  ...(ratingScore !== null ? { ratingScore } : {}),
                  ...(ratingCount !== null ? { ratingCount: BigInt(ratingCount) } : {}),
                  ...(productCount !== null ? { productCount } : {}),
                  echotikMetadata,
                  lastSeenAt: new Date(),
                },
                select: { id: true },
              });
              const bucketDate = new Date();
              bucketDate.setUTCHours(0, 0, 0, 0);
              await tx.shopRevenueSnapshot.upsert({
                where: { shopId_source_bucketDate: { shopId: shop.id, source: 'echotik', bucketDate } },
                create: {
                  shopId: shop.id, source: 'echotik', bucketDate,
                  gmvTotal: null, soldCountTotal: null, productCount,
                  ratingScore, ratingCount: ratingCount === null ? null : BigInt(ratingCount),
                  isEstimated: true, rawData: row as unknown as Prisma.InputJsonObject,
                },
                update: {
                  ...(productCount !== null ? { productCount } : {}),
                  ...(ratingScore !== null ? { ratingScore } : {}),
                  ...(ratingCount !== null ? { ratingCount: BigInt(ratingCount) } : {}),
                  capturedAt: new Date(), rawData: row as unknown as Prisma.InputJsonObject,
                },
              });
              return existing ? 'updated' as const : 'created' as const;
            });
            if (outcome === 'updated') result.updated += 1;
            else result.created += 1;
          } catch (error) {
            result.failed += 1;
            result.errors.push(
              `page ${page} row ${index + 1}: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
            throw error;
          }
        }
        if (result.failed > 0) throw new Error(`PostgreSQL ingestion failed on seller page ${page}`);
        const hasNextPage = hasNextEchoTikPage(rows.length, pageSize);
        await markEchoTikPageComplete(pageKey, !hasNextPage);
        if (!hasNextPage) break;
      } catch (error) {
        result.failed += 1;
        result.errors.push(
          `page ${page}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        await import('./echoTikSyncState.js').then(({ recordEchoTikSyncError }) => recordEchoTikSyncError(error));

        // Save progress before exiting
        logger.warn(`Stopping ingestion at page ${page} due to error`);
        break;
      }
    }

    logger.info(
      `Shop full ingestion completed: received=${result.received}, created=${result.created}, updated=${result.updated}, failed=${result.failed}, API calls=${result.apiRequestsUsed}`,
    );
  } catch (error) {
    result.failed += 1;
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'unknown error'}`);
    await import('./echoTikSyncState.js').then(({ recordEchoTikSyncError }) => recordEchoTikSyncError(error));
    logger.error(`Shop ingestion failed: ${result.errors[0]}`);
  }

  return result;
}
