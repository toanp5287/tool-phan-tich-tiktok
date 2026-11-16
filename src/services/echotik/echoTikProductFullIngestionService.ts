import prisma from '../../config/db.js';
import { Prisma } from '@prisma/client';
import { getActiveEchoTikRequestBudget } from './echoTikRequestBudget.js';
import { hasNextEchoTikPage } from './echoTikSyncRules.js';
import { getEchoTikClient } from './echoTikClient.js';
import { createLogger } from '../../utils/logger.js';
import { getEchoTikCachedResponse, getNextEchoTikPage, isBeyondEchoTikTerminalPage, isEchoTikPageComplete, markEchoTikPageComplete, saveEchoTikRawResponse } from './echoTikSyncState.js';

const logger = createLogger('echotik-product-full-ingestion');

export interface ProductIngestionResult {
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

function optionalDecimal(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) {
    return null;
  }
  return text;
}

function optionalInteger(value: unknown): bigint | number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed;
}

function extractProductRows(response: unknown): Record<string, unknown>[] {
  const envelope = asObject(response);
  if (!envelope || !Array.isArray(envelope.data)) {
    throw new Error('Product List response does not contain a data array');
  }
  if (envelope.code !== undefined && ![0, 200, '0', '200'].includes(envelope.code as never)) {
    throw new Error(`Product List returned API code ${String(envelope.code)}`);
  }

  return envelope.data.map((row, index) => {
    const object = asObject(row);
    if (!object) throw new Error(`Product List row ${index + 1} is not an object`);
    return object;
  });
}

/**
 * Ingest all EchoTik products with full pagination
 */
export async function ingestEchoTikProductsFullDataset(
  maxPages: number = 50,
  pageSize: number = 10,
): Promise<ProductIngestionResult> {
  if (pageSize !== 10) throw new Error('EchoTik product ingestion requires page_size=10');
  const result: ProductIngestionResult = {
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

    const firstPage = await getNextEchoTikPage('product-list', pageSize);
    for (let page = firstPage; page < firstPage + maxPages; page++) {
      try {
        if (getActiveEchoTikRequestBudget()?.remaining === 0) break;
        const pageKey = `product-list:${page}:${pageSize}`;
        if (await isBeyondEchoTikTerminalPage('product-list', page, pageSize)) break;
        if (await isEchoTikPageComplete(pageKey)) continue;

        logger.info(`Fetching product page ${page}/${maxPages} (size=${pageSize})...`);

        const cached = await getEchoTikCachedResponse(pageKey);
        const budget = getActiveEchoTikRequestBudget();
        const usedBefore = budget?.used ?? 0;
        let response: Record<string, unknown>;
        try {
          response = (cached ?? await client.getProductList(page, pageSize, 'VN')) as Record<string, unknown>;
        } finally {
          if (cached === null && budget && budget.used > usedBefore) result.apiRequestsUsed += budget.used - usedBefore;
        }
        if (cached === null && !budget) result.apiRequestsUsed += 1;

        // Save raw response for debugging
        if (cached === null) result.rawResponsePath = await saveEchoTikRawResponse('product-list', page, response, pageKey);

        const rows = extractProductRows(response);
        if (rows.length === 0) {
          logger.info(`Page ${page}: No more products returned, stopping pagination`);
          await markEchoTikPageComplete(pageKey, true);
          break;
        }

        result.received += rows.length;
        logger.info(`Page ${page}: Processing ${rows.length} products...`);

        // Process each product
        for (const [index, row] of rows.entries()) {
          try {
            const platformProductId = requiredText(row.product_id);
            const title = requiredText(row.title);
            const sellerId = requiredText(row.seller_id);

            if (!platformProductId || !title || !sellerId) {
              throw new Error('required product_id, title, or seller_id is missing');
            }

            // Link only to the EchoTik shop row; never attach to another source.
            const shop = await prisma.shop.findUnique({
              where: {
                platformShopId_source: { platformShopId: sellerId, source: 'echotik' },
              },
              select: { id: true },
            });

            const minPrice = optionalDecimal(row.min_price);
            const maxPrice = optionalDecimal(row.max_price);
            const ratingScore = optionalDecimal(row.rating);
            const ratingCount = optionalInteger(row.review_count);
            const soldCount = optionalInteger(row.total_sold_cnt);
            const category = requiredText(row.category_name);

            const bucketDate = new Date();
            bucketDate.setUTCHours(0, 0, 0, 0);
            const outcome = await prisma.$transaction(async (tx) => {
              const existing = await tx.product.findUnique({
                where: { platformProductId_source: { platformProductId, source: 'echotik' } },
                select: { id: true },
              });
              const product = await tx.product.upsert({
                where: { platformProductId_source: { platformProductId, source: 'echotik' } },
                create: {
                  platformProductId, source: 'echotik', title, shopId: shop?.id ?? null,
                  minPrice, maxPrice, category, ratingScore,
                  ratingCount: ratingCount === null ? null : BigInt(ratingCount),
                  soldCount: soldCount === null ? null : BigInt(soldCount),
                  region: 'VN', currency: 'VND',
                },
                update: {
                  title, shopId: shop?.id ?? null,
                  ...(minPrice !== null ? { minPrice } : {}),
                  ...(maxPrice !== null ? { maxPrice } : {}),
                  ...(category !== null ? { category } : {}),
                  ...(ratingScore !== null ? { ratingScore } : {}),
                  ...(ratingCount !== null ? { ratingCount: BigInt(ratingCount) } : {}),
                  ...(soldCount !== null ? { soldCount: BigInt(soldCount) } : {}),
                  lastSeenAt: new Date(),
                },
                select: { id: true },
              });
              await tx.productSnapshot.upsert({
                where: { productId_source_bucketDate: { productId: product.id, source: 'echotik', bucketDate } },
                create: {
                  productId: product.id, source: 'echotik', bucketDate,
                  price: minPrice, ratingScore,
                  ratingCount: ratingCount === null ? null : BigInt(ratingCount),
                  soldCountTotal: soldCount === null ? null : BigInt(soldCount),
                  isEstimated: false, rawData: row as unknown as Prisma.InputJsonObject,
                },
                update: {
                  ...(minPrice !== null ? { price: minPrice } : {}),
                  ...(ratingScore !== null ? { ratingScore } : {}),
                  ...(ratingCount !== null ? { ratingCount: BigInt(ratingCount) } : {}),
                  ...(soldCount !== null ? { soldCountTotal: BigInt(soldCount) } : {}),
                  isEstimated: false, rawData: row as unknown as Prisma.InputJsonObject,
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
        if (result.failed > 0) throw new Error(`PostgreSQL ingestion failed on product page ${page}`);
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

    // Log quota usage
    logger.info(
      `Product full ingestion completed: received=${result.received}, created=${result.created}, updated=${result.updated}, failed=${result.failed}, API calls=${result.apiRequestsUsed}`,
    );
  } catch (error) {
    result.failed += 1;
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'unknown error'}`);
    await import('./echoTikSyncState.js').then(({ recordEchoTikSyncError }) => recordEchoTikSyncError(error));
    logger.error(`Product ingestion failed: ${result.errors[0]}`);
  }

  return result;
}
