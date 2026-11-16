import { env } from '../config/env.js';
import { JOB_TRIGGER, JOB_TYPE, SOURCE } from '../config/constants.js';
import type { ShopScrapeRunResult } from '../types/shopScrape.js';
import { createLogger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';
import prisma from '../config/db.js';
import { acquireFileLock, type FileLock } from '../utils/fileLock.js';
import { fetchShopItemsBatched, resolveBudget } from './scraper/apifyShopService.js';
import { normalizeShopItemsSafe } from './scraper/shopNormalizer.js';
import { ingestShopRecords } from './scraper/shopIngestionService.js';
import { createScrapeJob, markJobCompleted, markJobFailed } from './jobService.js';
import { discoverCreatorsFromShopRecords } from './scraper/creatorSearchService.js';
import {
  generateRunId,
  getTaskLockState,
  releaseTaskLock,
  tryAcquireTaskLock,
} from './scrapeTaskLock.js';

const logger = createLogger('shop-scraper');

let activeShopRun: Promise<ShopScrapeRunResult> | null = null;

export interface RunShopScrapeOptions {
  trigger?: string;
  force?: boolean;
  region?: string;
  keywords?: string[];
  productsPerSearch?: number;
  /** Trần sản phẩm lần này — luôn bị ép <= 30. */
  maxItems?: number;
}

/** True khi đang có phiên cào (cờ khóa tác vụ hoặc promise đang chạy). */
export function isShopScrapeRunning(): boolean {
  return getTaskLockState().isRunning || activeShopRun !== null;
}

/**
 * Pipeline độc quyền TikTok Shop:
 * Apify Shop Actor -> chuẩn hoá từng item (cô lập lỗi) -> ghi DB + snapshot delta.
 *
 * Kỹ thuật kiểm soát chi phí:
 *  1. In-process Task Lock  -> chặn 2 luồng đồng thời trong cùng tiến trình.
 *  2. File Lock đa tiến trình -> chặn 2 tiến trình (server + CLI) cùng cào.
 *  3. Ngân sách cứng 30 sản phẩm/lần chạy (Actor input + slice).
 *  4. Retry có giới hạn + sleep, không retry vô hạn.
 */
export async function runShopScrapePipeline(
  options: RunShopScrapeOptions = {},
): Promise<ShopScrapeRunResult> {
  // Single-flight: nếu đang chạy, trả về đúng promise hiện tại (không tạo Actor run mới).
  if (activeShopRun) {
    logger.warn('Một phiên cào TikTok Shop khác đang chạy — dùng lại kết quả thay vì tạo phiên mới');
    return activeShopRun;
  }

  const runId = generateRunId('shop');
  const trigger = options.trigger ?? JOB_TRIGGER.MANUAL;

  if (!tryAcquireTaskLock({ trigger, runId })) {
    logger.warn('Không chiếm được khóa tác vụ — bỏ qua yêu cầu cào để tránh phát sinh chi phí');
    return skippedResult(options);
  }

  // Khóa đa tiến trình: server scheduler và `npm run scrape` không thể chạy cùng lúc.
  const fileLock: FileLock | null = acquireFileLock({
    metadata: { trigger, runId, pid: process.pid },
    staleMs: env.scrape.lockStaleMs,
  });

  if (!fileLock) {
    logger.warn('Tiến trình khác đang cào (file lock) — bỏ qua yêu cầu cào để tránh chi phí kép');
    releaseTaskLock(runId);
    return skippedResult(options);
  }

  activeShopRun = executeShopPipeline(options, runId)
    .finally(() => {
      activeShopRun = null;
      fileLock.release();
      releaseTaskLock(runId);
    });

  return activeShopRun;
}

function skippedResult(options: RunShopScrapeOptions): ShopScrapeRunResult {
  return {
    jobId: 0,
    source: SOURCE.APIFY_SHOP,
    keywords: options.keywords ?? env.apify.shopKeywords,
    found: 0,
    saved: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    durationMs: 0,
  };
}

async function executeShopPipeline(
  options: RunShopScrapeOptions,
  runId: string,
): Promise<ShopScrapeRunResult> {
  const startedAt = Date.now();
  const region = 'VN';
  const keywords =
    options.keywords && options.keywords.length > 0 ? options.keywords : env.apify.shopKeywords;
  const budget = resolveBudget(options.maxItems ?? env.apify.shopMaxItemsPerRun);

  // Conservative calendar-month cap: every created shop job counts, including
  // failed runs, so retries cannot silently exceed the user's spend ceiling.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthlyRuns = await prisma.scrapeJob.count({
    where: { source: SOURCE.APIFY_SHOP, jobType: JOB_TYPE.SHOP_SYNC, createdAt: { gte: monthStart } },
  });
  if (monthlyRuns >= env.apify.shopMonthlyRunLimit) {
    logger.warn(`Monthly Apify cap reached (${monthlyRuns}/${env.apify.shopMonthlyRunLimit}); no Actor run started`);
    return skippedResult(options);
  }

  const job = await createScrapeJob({
    source: SOURCE.APIFY_SHOP,
    jobType: JOB_TYPE.SHOP_SYNC,
    trigger: options.trigger ?? JOB_TRIGGER.MANUAL,
    region,
    metadata: {
      actor: env.apify.shopActorId,
      runId,
      keywords,
      budget,
    },
  });

  try {
    const fetched = await fetchShopItemsBatched({
      keywords,
      region,
      maxItems: budget,
      productsPerSearch: options.productsPerSearch,
    });

    if (fetched.failures.length > 0) {
      logger.warn(`${fetched.failures.length} batch từ khoá thất bại`);
    }

    if (fetched.items.length === 0) {
      await markJobCompleted(job.id, {
        status: 'PARTIAL',
        recordsFound: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        errorMessage:
          fetched.failures.length > 0
            ? `Không thu được sản phẩm TikTok Shop. Lỗi batch: ${fetched.failures.slice(0, 3).join(' | ')}`
            : 'Actor TikTok Shop trả về 0 sản phẩm cho các từ khoá đã cấu hình.',
        metadata: { keywords, budget, runId },
      });

      return {
        jobId: job.id,
        source: SOURCE.APIFY_SHOP,
        keywords,
        found: 0,
        saved: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    // Cắt cứng lần cuối trước khi chuẩn hoá — tuyệt đối không vượt ngân sách.
    const budgetedItems = fetched.items.slice(0, budget);

    const normalizeResult = normalizeShopItemsSafe(budgetedItems, {
      requiredMarket: 'VN',
      allowUnknownMarket: env.apify.shopAllowUnknownMarket,
    });
    const skipped = Math.max(
      0,
      budgetedItems.length - normalizeResult.records.length - normalizeResult.failures.length,
    );

    if (skipped > 0) {
      logger.warn(
        `Đã loại ${skipped} sản phẩm không thuộc thị trường Việt Nam (thiếu tín hiệu VND hoặc URL /vn/)`,
      );
    }

    if (normalizeResult.failures.length > 0) {
      logger.warn(
        `Bỏ qua ${normalizeResult.failures.length} sản phẩm lỗi định dạng khi chuẩn hoá`,
        normalizeResult.failures.slice(0, 5),
      );
    }

    // Không gọi ghi DB khi rỗng — tránh tạo snapshot rỗng vô nghĩa.
    const ingestResult = await ingestShopRecords(normalizeResult.records, {
      jobId: job.id,
      source: SOURCE.APIFY_SHOP,
      concurrency: env.scrape.concurrency,
      region,
    });

    let creatorProfilesFound = 0;
    let creatorProfilesSaved = 0;
    let creatorProfilesFailed = 0;
    try {
      const discovery = await discoverCreatorsFromShopRecords(
        normalizeResult.records,
        job.id,
        env.apify.creatorSearchMaxProfiles,
      );
      creatorProfilesFound = discovery.found;
      creatorProfilesSaved = discovery.saved;
      creatorProfilesFailed = discovery.failed;
    } catch (error) {
      logger.warn(`Creator profile discovery failed: ${toErrorMessage(error)}`);
      creatorProfilesFailed += 1;
    }

    // Inline relatedVideos are persisted during ingestion. Do not start a
    // separate paid trend Actor outside the monthly product/profile budget.
    const trendVideos = normalizeResult.records.reduce((sum, record) => sum + record.videos.length, 0);

    const totalSkipped = ingestResult.skipped + skipped;
    const status =
      ingestResult.failed === 0 && totalSkipped === 0
        ? 'COMPLETED'
        : ingestResult.saved + ingestResult.updated > 0
          ? 'PARTIAL'
          : 'FAILED';

    await markJobCompleted(job.id, {
      status,
      recordsFound: budgetedItems.length,
      recordsSaved: ingestResult.saved,
      recordsUpdated: ingestResult.updated,
      recordsFailed: ingestResult.failed + normalizeResult.failures.length,
      errorMessage:
        ingestResult.errors.length > 0
          ? ingestResult.errors
              .slice(0, 10)
              .map((item) => item.message)
              .join(' | ')
          : skipped > 0 && normalizeResult.records.length === 0
            ? `Toàn bộ ${skipped} item trả về không thuộc thị trường VN (Actor có thể đang phục vụ thị trường khác).`
            : null,
      metadata: {
        runId,
        budget,
        rawCount: fetched.rawCount,
        budgetReached: fetched.budgetReached,
        keywords,
        failures: fetched.failures.slice(0, 10),
        skipped,
        marketRejected: skipped,
        trendVideos,
        creatorProfilesFound,
        creatorProfilesSaved,
        creatorProfilesFailed,
        monthlyRunsBeforeThisRun: monthlyRuns,
        region,
      },
    });

    return {
      jobId: job.id,
      source: SOURCE.APIFY_SHOP,
      keywords,
      found: ingestResult.found,
      saved: ingestResult.saved,
      updated: ingestResult.updated,
      failed: ingestResult.failed,
      skipped: totalSkipped,
      durationMs: Date.now() - startedAt,
      rawCount: fetched.rawCount,
      creatorProfilesFound,
      creatorProfilesSaved,
      creatorProfilesFailed,
    };
  } catch (error) {
    await markJobFailed(job.id, error);
    logger.error(`Pipeline cào TikTok Shop thất bại: ${toErrorMessage(error)}`);
    throw error;
  }
}
