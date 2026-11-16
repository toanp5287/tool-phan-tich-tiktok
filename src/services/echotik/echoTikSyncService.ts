import prisma from '../../config/db.js';
import { env, isEchoTikEnabled } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { getEchoTikClient } from './echoTikClient.js';
import {
  canSyncEchoTik,
  getQuotaStatus,
  logQuotaUsage,
} from './echoTikQuotaService.js';
import { normalizeEchoTikProducts } from './echoTikNormalizer.js';
import { ingestEchoTikBatch } from './echoTikIngestionService.js';
import type { ScrapeJobStatus } from '@prisma/client';
import { runFullEchoTikSync } from './echoTikFullSyncOrchestrator.js';

const logger = createLogger('echotik-sync');

export interface EchoTikSyncResult {
  success: boolean;
  jobId: number;
  recordsFound: number;
  recordsSaved: number;
  recordsFailed: number;
  durationMs: number;
  error?: string;
}

/**
 * Chạy sync dữ liệu từ EchoTik API
 * - Kiểm tra quota
 * - Gọi API
 * - Normalize dữ liệu
 * - Ingest vào database
 */
export async function syncEchoTikData(): Promise<EchoTikSyncResult> {
  const startTime = Date.now();

  const full = await runFullEchoTikSync();
  return {
    success: full.success,
    jobId: 0,
    recordsFound: full.shops.received + full.products.received,
    recordsSaved: full.shops.created + full.products.created,
    recordsFailed: full.shops.failed + full.products.failed + full.categories.failed,
    durationMs: full.durationMs,
    ...(!full.success ? { error: full.errors.join('; ') || 'EchoTik full sync failed' } : {}),
  };

  // Kiểm tra EchoTik enabled
  if (!isEchoTikEnabled()) {
    logger.warn('EchoTik is not enabled (ECHOTIK_API_KEY not set)');
    return {
      success: false,
      jobId: 0,
      recordsFound: 0,
      recordsSaved: 0,
      recordsFailed: 0,
      durationMs: 0,
      error: 'EchoTik not enabled',
    };
  }

  // Tạo ScrapeJob
  const job = await prisma.scrapeJob.create({
    data: {
      source: 'echotik',
      jobType: 'sync',
      trigger: 'scheduler',
      region: 'VN',
      status: 'PENDING',
    },
  });

  try {
    // Kiểm tra quota
    const canSync = await canSyncEchoTik();
    if (!canSync) {
      await updateJobStatus(job.id, 'FAILED', 'Quota limit reached');
      return {
        success: false,
        jobId: job.id,
        recordsFound: 0,
        recordsSaved: 0,
        recordsFailed: 0,
        durationMs: Date.now() - startTime,
        error: 'Quota limit reached',
      };
    }

    // Lấy quota info
    const quotaStatus = await getQuotaStatus();
    logger.info(
      `Quota status: ${quotaStatus.usedThisMonth}/${quotaStatus.totalQuota} used`,
    );

    // Cập nhật job status
    await updateJobStatus(job.id, 'RUNNING');

    // Gọi EchoTik API để lấy dữ liệu
    const client = getEchoTikClient();
    logger.info('Fetching data from EchoTik API');

    // Lấy category L1
    const categoryL1Response = await client.getCategoryL1(env.echotik.language);
    const categories = Array.isArray(categoryL1Response.data)
      ? (categoryL1Response.data as Record<string, unknown>[])
      : [];

    // Lấy product list
    const productResponse = await client.getProductList(1, 10, env.echotik.region);
    const products = Array.isArray(productResponse.data)
      ? (productResponse.data as Record<string, unknown>[])
      : [];

    // Lấy seller list
    const sellerResponse = await client.getSellerList(1, 10, env.echotik.region);
    const sellers = Array.isArray(sellerResponse.data)
      ? (sellerResponse.data as Record<string, unknown>[])
      : [];

    const recordsFound = categories.length + products.length + sellers.length;
    logger.info(`Found ${recordsFound} records from EchoTik`);

    // Log quota usage (4 requests: L1, products, sellers, + buffer)
    await logQuotaUsage('sync_batch', 4);

    // Cập nhật job status thành công
    const durationMs = Date.now() - startTime;
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED' as ScrapeJobStatus,
        finishedAt: new Date(),
        durationMs,
        recordsFound,
        recordsSaved: recordsFound,
        recordsUpdated: 0,
        recordsFailed: 0,
      },
    });

    logger.info(
      `EchoTik sync completed (job #${job.id}): ${recordsFound} records in ${durationMs}ms`,
    );

    return {
      success: true,
      jobId: job.id,
      recordsFound,
      recordsSaved: recordsFound,
      recordsFailed: 0,
      durationMs,
    };
  } catch (error) {
    const errorMessage = String(error);
    logger.error(`EchoTik sync failed: ${errorMessage}`);

    const durationMs = Date.now() - startTime;
    await prisma.scrapeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED' as ScrapeJobStatus,
        finishedAt: new Date(),
        durationMs,
        errorMessage,
      },
    });

    return {
      success: false,
      jobId: job.id,
      recordsFound: 0,
      recordsSaved: 0,
      recordsFailed: 0,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Cập nhật status của ScrapeJob
 */
async function updateJobStatus(
  jobId: number,
  status: ScrapeJobStatus,
  errorMessage?: string,
) {
  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status,
      startedAt: status === 'RUNNING' ? new Date() : undefined,
      errorMessage,
    },
  });
}

/**
 * Kiểm tra xem EchoTik sync có thể chạy không
 */
export async function canRunEchoTikSync(): Promise<{ canRun: boolean; reason?: string }> {
  if (!isEchoTikEnabled()) {
    return { canRun: false, reason: 'EchoTik not enabled' };
  }

  const canSync = await canSyncEchoTik();
  if (!canSync) {
    const quotaStatus = await getQuotaStatus();
    return {
      canRun: false,
      reason: `Quota limit reached (${quotaStatus.usedThisMonth}/${quotaStatus.totalQuota})`,
    };
  }

  return { canRun: true };
}
