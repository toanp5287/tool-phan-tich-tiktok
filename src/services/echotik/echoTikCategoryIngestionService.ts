import prisma from '../../config/db.js';
import { getEchoTikClient } from './echoTikClient.js';
import { getActiveEchoTikRequestBudget } from './echoTikRequestBudget.js';
import { normalizeEchoTikCategoryL1, normalizeEchoTikCategoryL2 } from './echoTikNormalizer.js';
import { createLogger } from '../../utils/logger.js';
import { getEchoTikCachedResponse, isEchoTikPageComplete, markEchoTikPageComplete, saveEchoTikRawResponse } from './echoTikSyncState.js';

const logger = createLogger('echotik-category-ingestion');

export interface CategoryIngestionResult {
  received: number;
  skipped: number;
  l1Created: number;
  l1Updated: number;
  l2Created: number;
  l2Updated: number;
  failed: number;
  errors: string[];
  apiRequestsUsed: number;
}

/**
 * Ingest all EchoTik categories (L1 + L2)
 * Uses 1 request for L1, then N requests for each L2 category
 */
export async function ingestEchoTikCategories(): Promise<CategoryIngestionResult> {
  const result: CategoryIngestionResult = {
    received: 0,
    skipped: 0,
    l1Created: 0,
    l1Updated: 0,
    l2Created: 0,
    l2Updated: 0,
    failed: 0,
    errors: [],
    apiRequestsUsed: 0,
  };

  try {
    const client = getEchoTikClient();

    // Step 1: Fetch L1 categories
    logger.info('Fetching EchoTik L1 categories...');
    const l1Key = 'category-l1:vi-VN';
    let l1Response: Record<string, unknown>;
    const l1Complete = await isEchoTikPageComplete(l1Key);
    if (l1Complete) return result;
    const cachedL1 = await getEchoTikCachedResponse(l1Key);
    if (l1Complete && cachedL1 === null) {
      return result;
    }
    const budgetBeforeL1 = getActiveEchoTikRequestBudget();
    const usedBeforeL1 = budgetBeforeL1?.used ?? 0;
    try {
      l1Response = (cachedL1 ?? await client.getCategoryL1('vi-VN')) as Record<string, unknown>;
    } finally {
      if (cachedL1 === null && budgetBeforeL1 && budgetBeforeL1.used > usedBeforeL1) result.apiRequestsUsed += budgetBeforeL1.used - usedBeforeL1;
      else if (cachedL1 === null && !budgetBeforeL1) result.apiRequestsUsed += 1;
    }
    if (cachedL1 === null) {
      await saveEchoTikRawResponse('category-l1', null, l1Response, l1Key);
    }

    const l1Categories = Array.isArray(l1Response.data)
      ? (l1Response.data as Record<string, unknown>[])
      : [];

    if (l1Categories.length === 0) {
      logger.warn('No L1 categories returned from API');
      await markEchoTikPageComplete(l1Key, true);
      return result;
    }

    logger.info(`Received ${l1Categories.length} L1 categories`);
    result.received += l1Categories.length;

    // Step 2: Process L1 categories
    for (const [index, l1Data] of l1Categories.entries()) {
      try {
        const normalized = normalizeEchoTikCategoryL1(l1Data);

        // Upsert L1 category
        const existingCategory = await prisma.category.findFirst({
          where: { slug: normalized.slug },
          select: { id: true },
        });
        const category = await prisma.category.upsert({
          where: { slug: normalized.slug },
          create: {
            name: normalized.name,
            slug: normalized.slug,
            sortOrder: index,
            isActive: true,
          },
          update: {},
        });

        if (existingCategory) result.skipped += 1;
        else result.l1Created += 1;

        // Step 3: Fetch L2 categories for this L1
        try {
          logger.info(`Fetching L2 categories for ${normalized.name}...`);
          const l2Key = `category-l2:${normalized.id}:vi-VN`;
          const l2Complete = await isEchoTikPageComplete(l2Key);
          if (l2Complete) continue;
          const cachedL2 = await getEchoTikCachedResponse(l2Key);
          if (cachedL2 === null && getActiveEchoTikRequestBudget()?.remaining === 0) return result;
          const budgetBeforeL2 = getActiveEchoTikRequestBudget();
          const usedBeforeL2 = budgetBeforeL2?.used ?? 0;
          let l2Response: Record<string, unknown>;
          try {
            l2Response = (cachedL2 ?? await client.getCategoryL2(normalized.id, 'vi-VN')) as Record<string, unknown>;
          } finally {
            if (cachedL2 === null && budgetBeforeL2 && budgetBeforeL2.used > usedBeforeL2) result.apiRequestsUsed += budgetBeforeL2.used - usedBeforeL2;
            else if (cachedL2 === null && !budgetBeforeL2) result.apiRequestsUsed += 1;
          }
          if (cachedL2 === null) {
            await saveEchoTikRawResponse(`category-l2-${normalized.id}`, null, l2Response, l2Key);
          }

          const l2Categories = Array.isArray(l2Response.data)
            ? (l2Response.data as Record<string, unknown>[])
            : [];

          // Process L2 categories
          for (const [l2Index, l2Data] of l2Categories.entries()) {
            result.received += 1;
            try {
              const l2Normalized = normalizeEchoTikCategoryL2(l2Data, normalized.id);
              const existingL2 = await prisma.subCategory.findFirst({
                where: { categoryId: category.id, slug: l2Normalized.slug },
                select: { id: true },
              });
              await prisma.subCategory.upsert({
                where: {
                  categoryId_slug: {
                    categoryId: category.id,
                    slug: l2Normalized.slug,
                  },
                },
                create: {
                  categoryId: category.id,
                  name: l2Normalized.name,
                  slug: l2Normalized.slug,
                  sortOrder: l2Index,
                  isActive: true,
                },
                update: {},
              });

              if (existingL2) result.skipped += 1;
              else result.l2Created += 1;
            } catch (error) {
              result.failed += 1;
              result.errors.push(
                `L2 category at index ${l2Index}: ${error instanceof Error ? error.message : 'unknown error'}`,
              );
              throw error;
            }
          }
          if (result.failed > 0) throw new Error(`PostgreSQL ingestion failed for category ${normalized.id}`);
          logger.info(`Processed ${l2Categories.length} L2 categories for ${normalized.name}`);
          await markEchoTikPageComplete(l2Key, true);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'unknown error';
          
          // Check if quota exceeded — stop all L2 fetching
          result.failed += 1;
          result.errors.push(`Failed to fetch/process L2 for category ${normalized.id}: ${errorMsg}`);
          throw error;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'unknown error';
        
        // If quota exceeded, stop all category ingestion
        result.failed += 1;
        result.errors.push(`L1 category at index ${index}: ${errorMsg}`);
        throw error;
      }
    }

    await markEchoTikPageComplete(l1Key, true);

    logger.info(
      `Category ingestion completed: L1 created=${result.l1Created}, L2 created=${result.l2Created}, failed=${result.failed}, API calls=${result.apiRequestsUsed}`,
    );
  } catch (error) {
    result.failed += 1;
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'unknown error'}`);
    logger.error(`Category ingestion failed: ${result.errors[0]}`);
  }

  return result;
}
