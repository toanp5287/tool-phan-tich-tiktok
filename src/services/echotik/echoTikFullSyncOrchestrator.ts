import { createLogger } from '../../utils/logger.js';
import { ingestEchoTikShopsFullDataset } from './echoTikShopFullIngestionService.js';
import { ingestEchoTikProductsFullDataset } from './echoTikProductFullIngestionService.js';
import {
  beginEchoTikRequestBudget,
  endEchoTikRequestBudget,
} from './echoTikQuotaService.js';
import {
  acquireEchoTikSyncLock,
  recordEchoTikSyncError,
} from './echoTikSyncState.js';
import { ingestEchoTikCategories } from './echoTikCategoryIngestionService.js';
import { ingestEchoTikProductTrends } from './echoTikProductTrendIngestionService.js';
import { getTrustedEchoTikUsage } from './echoTikQuotaService.js';
import prisma from '../../config/db.js';
import { hasPersistedEchoTikRecords } from './echoTikSyncRules.js';
import { echoTikSyncContext } from './echoTikSyncContext.js';

const logger = createLogger('echotik-full-sync-orchestrator');

export interface FullSyncResult {
  success: boolean;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  categories: {
    l1Created: number;
    l1Updated: number;
    l2Created: number;
    l2Updated: number;
    skipped: number;
    failed: number;
  };
  shops: {
    received: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    apiRequestsUsed: number;
  };
  products: {
    received: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    apiRequestsUsed: number;
  };
  totalApiCalls: number;
  requestsRemaining: number;
  trends: {
    received: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    pages: number;
  };
  errors: string[];
}

/**
 * Master orchestrator: Ingest all EchoTik data (Categories → Shops → Products)
 * Handles quota management and graceful degradation
 */
export async function runFullEchoTikSync(options?: {
  maxShopPages?: number;
  maxProductPages?: number;
}): Promise<FullSyncResult> {
  if (!echoTikSyncContext.getStore()) throw new Error('Full sync is disabled: use one guarded EchoTik group command (maximum 15 requests)');
  const startTime = new Date();
  logger.info('🚀 Starting full EchoTik data sync...');

  const result: FullSyncResult = {
    success: false,
    startTime,
    endTime: new Date(),
    durationMs: 0,
    categories: { l1Created: 0, l1Updated: 0, l2Created: 0, l2Updated: 0, skipped: 0, failed: 0 },
    shops: { received: 0, created: 0, updated: 0, skipped: 0, failed: 0, apiRequestsUsed: 0 },
    products: { received: 0, created: 0, updated: 0, skipped: 0, failed: 0, apiRequestsUsed: 0 },
    totalApiCalls: 0,
    requestsRemaining: 50,
    trends: { received: 0, created: 0, updated: 0, skipped: 0, failed: 0, pages: 0 },
    errors: [],
  };

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireEchoTikSyncLock();
    const budget = await beginEchoTikRequestBudget();
    if (budget.remaining === 0) throw new Error('No EchoTik request budget remains');

    // Shops and products take priority; each page uses the shared HTTP budget.
    const shopPageAllocation = Math.min(options?.maxShopPages ?? 3, budget.remaining);
    logger.info('🏪 Step 2: Ingesting Shops...');
    const shopResult = await ingestEchoTikShopsFullDataset(
      shopPageAllocation,
      10,
    );
    result.shops = {
      received: shopResult.received,
      created: shopResult.created,
      updated: shopResult.updated,
      failed: shopResult.failed,
      skipped: shopResult.skipped,
      apiRequestsUsed: shopResult.apiRequestsUsed,
    };
    result.totalApiCalls += shopResult.apiRequestsUsed;

    if (shopResult.errors.length > 0) {
      result.errors.push(`Shops: ${shopResult.errors.slice(0, 5).join('; ')}`);
    }

    logger.info(
      `✅ Shops done: created=${shopResult.created}, updated=${shopResult.updated}, failed=${shopResult.failed}, API calls=${shopResult.apiRequestsUsed}`,
    );
    if (shopResult.failed > 0) throw new Error(`Shop sync stopped: ${shopResult.errors[0] ?? 'ingestion failure'}`);

    logger.info('📦 Step 3: Ingesting Products...');
    const productResult = budget.remaining > 0
      ? await ingestEchoTikProductsFullDataset(Math.min(options?.maxProductPages ?? 3, budget.remaining), 10)
      : { received: 0, created: 0, updated: 0, skipped: 0, failed: 0, apiRequestsUsed: 0, rawResponsePath: '', errors: ['Deferred: request budget exhausted'] };
    if (budget.remaining === 0 && productResult.errors[0]?.startsWith('Deferred:')) {
      result.errors.push('Product, Product Trends, and Category phases deferred: no account requests remain.');
      throw new Error('Request budget exhausted after Shop phase');
    }
    result.products = {
      received: productResult.received,
      created: productResult.created,
      updated: productResult.updated,
      failed: productResult.failed,
      skipped: productResult.skipped,
      apiRequestsUsed: productResult.apiRequestsUsed,
    };
    result.totalApiCalls += productResult.apiRequestsUsed;

    if (productResult.errors.length > 0) {
      result.errors.push(`Products: ${productResult.errors.slice(0, 5).join('; ')}`);
    }

    logger.info(
      `✅ Products done: created=${productResult.created}, updated=${productResult.updated}, failed=${productResult.failed}, API calls=${productResult.apiRequestsUsed}`,
    );
    if (productResult.failed > 0) throw new Error(`Product sync stopped: ${productResult.errors[0] ?? 'ingestion failure'}`);

    if (budget.remaining > 0) {
      logger.info('📈 Step 4: Ingesting verified Product Trends...');
      const trendResult = await ingestEchoTikProductTrends(Math.max(1, Math.floor(budget.remaining / 2)));
      result.trends.received = trendResult.recordsReceived;
      result.trends.pages = trendResult.pages;
      result.trends.created = trendResult.created;
      result.trends.updated = trendResult.updated;
      result.trends.skipped = trendResult.skipped;
      result.trends.failed = trendResult.errors.length;
      result.totalApiCalls = budget.used;
      result.requestsRemaining = budget.remaining;
      if (trendResult.errors.length > 0) {
        throw new Error(`Product Trends sync stopped: ${trendResult.errors[0]}`);
      }
    } else {
      result.errors.push('Product Trends deferred: no request budget remains.');
    }

    logger.info('📂 Step 5: Ingesting verified L1/L2 categories...');
    const categoryResult = budget.remaining > 0
      ? await ingestEchoTikCategories()
      : { l1Created: 0, l1Updated: 0, l2Created: 0, l2Updated: 0, failed: 0, errors: [], apiRequestsUsed: 0 };
    result.categories = {
      l1Created: categoryResult.l1Created,
      l1Updated: categoryResult.l1Updated,
      l2Created: categoryResult.l2Created,
      l2Updated: categoryResult.l2Updated,
      skipped: 0,
      failed: categoryResult.failed,
    };
    result.totalApiCalls = budget.used;
    result.requestsRemaining = budget.remaining;
    if (categoryResult.errors.length > 0) throw new Error(`Category sync stopped: ${categoryResult.errors[0]}`);
    if (budget.remaining === 0 && categoryResult.apiRequestsUsed === 0) {
      result.errors.push('Categories deferred: no request budget remains.');
    }

    result.totalApiCalls = budget.used;
    result.requestsRemaining = budget.remaining;
    const recordsPersisted = result.shops.created + result.shops.updated + result.products.created + result.products.updated +
      result.categories.l1Created + result.categories.l1Updated + result.categories.l2Created + result.categories.l2Updated + result.trends.created + result.trends.updated;
    result.success = hasPersistedEchoTikRecords([recordsPersisted]) && result.shops.failed === 0 && result.products.failed === 0 && result.categories.failed === 0 && result.trends.failed === 0 && result.totalApiCalls <= 50;
    if (result.success) {
      const [persistedShops, persistedProducts, persistedCategories, persistedTrendSnapshots, storedRawResponses] = await Promise.all([
        prisma.shop.count({ where: { source: 'echotik' } }),
        prisma.product.count({ where: { source: 'echotik' } }),
        prisma.category.count(),
        prisma.productSnapshot.count({ where: { source: 'echotik' } }),
        prisma.echoTikRawResponse.count({ where: { source: 'echotik' } }),
      ]);
      result.success = storedRawResponses > 0 &&
        (result.shops.created + result.shops.updated === 0 || persistedShops > 0) &&
        (result.products.created + result.products.updated === 0 || persistedProducts > 0) &&
        (result.categories.l1Created + result.categories.l1Updated + result.categories.l2Created + result.categories.l2Updated === 0 || persistedCategories > 0) &&
        (result.trends.created + result.trends.updated === 0 || persistedTrendSnapshots > 0);
      if (!result.success) result.errors.push('Post-sync verification failed: EchoTik rows or raw response files were not found.');
    }
  } catch (error) {
    result.errors.push(`Fatal: ${error instanceof Error ? error.message : 'unknown error'}`);
    result.totalApiCalls = (await import('./echoTikRequestBudget.js')).getActiveEchoTikRequestBudget()?.used ?? result.totalApiCalls;
    result.requestsRemaining = Math.max(0, 50 - await getTrustedEchoTikUsage());
    await recordEchoTikSyncError(error).catch((stateError) => {
      result.errors.push(`Could not persist sync error state: ${stateError instanceof Error ? stateError.message : String(stateError)}`);
    });
    logger.error(`❌ Sync failed: ${result.errors[0]}`);
  } finally {
    endEchoTikRequestBudget();
    if (releaseLock) await releaseLock().catch((error) => logger.error(`Could not release EchoTik lock: ${error}`));
  }

  result.endTime = new Date();
  result.durationMs = result.endTime.getTime() - startTime.getTime();

  // Final report
  logger.info('');
  logger.info('╔════════════════════════════════════════════════════════╗');
  logger.info('║          FULL ECHOTIK SYNC COMPLETE                   ║');
  logger.info('╚════════════════════════════════════════════════════════╝');
  logger.info(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  logger.info(`API Calls in this run: ${result.totalApiCalls}/50 maximum`);
  logger.info(`Request budget remaining this run: ${result.requestsRemaining}`);
  logger.info(`Trends: received=${result.trends.received}, pages=${result.trends.pages}, created=${result.trends.created}, updated=${result.trends.updated}, skipped=${result.trends.skipped}, failed=${result.trends.failed}`);
  logger.info(`Categories: L1 created=${result.categories.l1Created}, updated=${result.categories.l1Updated}; L2 created=${result.categories.l2Created}, updated=${result.categories.l2Updated}, skipped=${result.categories.skipped}, failed=${result.categories.failed}`);
  logger.info('');
  logger.info('Categories:');
  logger.info(`  L1: ${result.categories.l1Created} created, ${result.categories.failed} failed`);
  logger.info(`  L2: ${result.categories.l2Created} created`);
  logger.info('');
  logger.info('Shops:');
  logger.info(
    `  ${result.shops.created} created, ${result.shops.updated} updated, ${result.shops.failed} failed (received: ${result.shops.received})`,
  );
  logger.info('');
  logger.info('Products:');
  logger.info(
    `  ${result.products.created} created, ${result.products.updated} updated, ${result.products.failed} failed (received: ${result.products.received})`,
  );
  logger.info('');

  if (result.errors.length > 0) {
    logger.warn('Errors:');
    result.errors.forEach((err) => logger.warn(`  - ${err}`));
  }

  logger.info(`Status: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
  logger.info('');

  return result;
}
