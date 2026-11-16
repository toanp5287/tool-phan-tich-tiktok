import prisma from '../../config/db.js';
import { Prisma } from '@prisma/client';
import { createLogger } from '../../utils/logger.js';
import { getActiveEchoTikRequestBudget } from './echoTikRequestBudget.js';
import { getEchoTikCachedResponse, getOrCreateEchoTikSyncDate, isBeyondEchoTikTerminalPage, isEchoTikPageComplete, markEchoTikPageComplete, saveEchoTikRawResponse } from './echoTikSyncState.js';
import { getEchoTikClient } from './echoTikClient.js';
import { recordEchoTikSyncError } from './echoTikSyncState.js';

const logger = createLogger('echotik-product-trend-ingestion');

export interface ProductTrendIngestionResult {
  productsProcessed: number;
  pages: number;
  recordsReceived: number;
  created: number;
  updated: number;
  skipped: number;
  stoppedForBudget: boolean;
  errors: string[];
}

function responseRows(response: unknown): unknown[] {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Product Trend response is not an object');
  }
  const envelope = response as Record<string, unknown>;
  if (envelope.code !== undefined && ![0, 200, '0', '200'].includes(envelope.code as never)) {
    throw new Error(`Product Trend returned API code ${String(envelope.code)}`);
  }
  if (!Array.isArray(envelope.data)) throw new Error('Product Trend response does not contain a data array');
  return envelope.data;
}

export async function ingestEchoTikProductTrends(maxProducts = 10): Promise<ProductTrendIngestionResult> {
  const result: ProductTrendIngestionResult = {
    productsProcessed: 0, pages: 0, recordsReceived: 0, created: 0, updated: 0, skipped: 0, stoppedForBudget: false, errors: [],
  };
  try {
    const budget = getActiveEchoTikRequestBudget();
    const products = await prisma.product.findMany({
      where: { source: 'echotik' },
      select: { id: true, platformProductId: true },
      orderBy: { id: 'asc' },
      take: maxProducts === Number.MAX_SAFE_INTEGER ? undefined : maxProducts,
    });
    const client = getEchoTikClient();
    const end = new Date(`${await getOrCreateEchoTikSyncDate()}T00:00:00.000Z`);
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const format = (date: Date) => date.toISOString().slice(0, 10);

    for (const product of products) {
      for (let page = 1; ; page += 1) {
        const key = `product-trend:${product.platformProductId}:${format(start)}:${format(end)}:${page}:10`;
        const terminalPrefix = `product-trend:${product.platformProductId}:${format(start)}:${format(end)}`;
        if (await isEchoTikPageComplete(key)) {
          if (await isBeyondEchoTikTerminalPage(terminalPrefix, page, 10)) break;
          continue;
        }
        if (await isBeyondEchoTikTerminalPage(terminalPrefix, page, 10)) break;
        if (budget && budget.remaining === 0) {
          result.stoppedForBudget = true;
          result.skipped += 1;
          return result;
        }
        const cached = await getEchoTikCachedResponse(key);
        const usedBefore = budget?.used ?? 0;
        let response: Record<string, unknown>;
        try {
          response = (cached ?? await client.getProductTrend(product.platformProductId, format(start), format(end), page, 10)) as Record<string, unknown>;
        } finally {
          if (cached === null && budget && budget.used > usedBefore) result.pages += budget.used - usedBefore;
        }
        if (cached === null && !budget) result.pages += 1;
        if (cached === null) await saveEchoTikRawResponse('product-trend', page, response, key);
        const rows = responseRows(response);
        result.recordsReceived += rows.length;
        if (rows.length === 0) {
          await markEchoTikPageComplete(key, true);
          break;
        }

        const bucketDate = new Date();
        bucketDate.setUTCHours(0, 0, 0, 0);
        const existing = await prisma.productSnapshot.findUnique({
          where: { productId_source_bucketDate: { productId: product.id, source: 'echotik', bucketDate } },
          select: { rawData: true, isEstimated: true },
        });
        const oldRaw = existing?.rawData && typeof existing.rawData === 'object' && !Array.isArray(existing.rawData)
          ? existing.rawData as Record<string, unknown>
          : {};
        const priorPages = Array.isArray(oldRaw.productTrendPages)
          ? oldRaw.productTrendPages.filter((item) => item === null || typeof item !== 'object' || (item as Record<string, unknown>).page !== page)
          : [];
        await prisma.productSnapshot.upsert({
          where: { productId_source_bucketDate: { productId: product.id, source: 'echotik', bucketDate } },
          create: {
            productId: product.id,
            source: 'echotik',
            bucketDate,
            isEstimated: false,
            rawData: { productTrendPages: [{ page, response }] } as unknown as Prisma.InputJsonObject,
          },
          update: {
            rawData: { ...oldRaw, productTrendPages: [...priorPages, { page, response }] } as unknown as Prisma.InputJsonObject,
            isEstimated: existing?.isEstimated ?? false,
          },
        });
        if (existing) result.updated += 1;
        else result.created += 1;
        await markEchoTikPageComplete(key, rows.length < 10);
        if (rows.length < 10) break;
      }
      result.productsProcessed += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    await recordEchoTikSyncError(error);
    logger.error(`Product trend ingestion stopped: ${message}`);
  }
  return result;
}
