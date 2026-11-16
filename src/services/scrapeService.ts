import { env } from '../config/env.js';
import { JOB_TRIGGER, JOB_TYPE, SOURCE } from '../config/constants.js';
import type { ScrapeRunResult, RawTikTokItem } from '../types/scraper.js';
import { createLogger } from '../utils/logger.js';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { normalizeRawItemsSafe, sortByViewsDesc } from './scraper/normalizer.js';
import { fetchTikTokItems, DEFAULT_TARGET_PROFILES } from './scraper/apifyService.js';
import { ingestRecords } from './scraper/ingestionService.js';
import { createScrapeJob, markJobCompleted, markJobFailed, findRunningJob } from './jobService.js';

const logger = createLogger('scraper');

let activeRun: Promise<ScrapeRunResult> | null = null;

export interface RunScrapeOptions {
  trigger?: string;
  force?: boolean;
  region?: string;
  profiles?: string[];
}

/**
 * Điều phối toàn bộ pipeline: Apify -> (fallback Playwright) -> normalize -> ingest.
 * Đảm bảo tại một thời điểm chỉ có 1 phiên chạy (single flight).
 */
export async function runScrapePipeline(options: RunScrapeOptions = {}): Promise<ScrapeRunResult> {
  if (env.scrape.shopOnly) {
    throw new AppError(
      'Full-sync mạng xã hội đã bị tắt trong chế độ chỉ cào TikTok Shop.',
      403,
      'SOCIAL_SCRAPE_DISABLED',
    );
  }

  if (activeRun) {
    logger.warn('Một phiên cào khác đang chạy, trả về kết quả hiện tại');
    return activeRun;
  }

  const runningJob = await findRunningJob(JOB_TYPE.FULL_SYNC);
  if (runningJob && !options.force) {
    logger.warn(`Job #${runningJob.id} đang chạy, bỏ qua yêu cầu mới`);
    return {
      jobId: runningJob.id,
      source: runningJob.source,
      found: runningJob.recordsFound,
      saved: runningJob.recordsSaved,
      updated: runningJob.recordsUpdated,
      failed: runningJob.recordsFailed,
      skipped: 0,
      durationMs: 0,
      usedFallback: false,
    };
  }

  activeRun = executePipeline(options).finally(() => {
    activeRun = null;
  });

  return activeRun;
}

export function isScrapeRunning(): boolean {
  return activeRun !== null;
}

async function executePipeline(options: RunScrapeOptions): Promise<ScrapeRunResult> {
  const startedAt = Date.now();
  const region = options.region ?? 'VN';
  const targetProfiles =
    options.profiles && options.profiles.length > 0
      ? options.profiles
      : env.apify.profiles.length > 0
        ? env.apify.profiles
        : [...DEFAULT_TARGET_PROFILES];

  const job = await createScrapeJob({
    source: SOURCE.APIFY,
    jobType: JOB_TYPE.FULL_SYNC,
    trigger: options.trigger ?? JOB_TRIGGER.MANUAL,
    region,
    metadata: { profiles: targetProfiles },
  });

  let usedFallback = false;
  let items: RawTikTokItem[] = [];

  try {
    try {
      const apifyResult = await fetchTikTokItems({
        profiles: targetProfiles,
        searchQueries: env.apify.searchQueries,
      });
      items = apifyResult.items;
    } catch (error) {
      if (!env.scrape.fallbackEnabled) throw error;

      logger.warn(`Apify thất bại, chuyển sang Playwright: ${toErrorMessage(error)}`);
      usedFallback = true;
      items = await fetchPlaywrightFallback();
    }

    if (items.length === 0) {
      await markJobCompleted(job.id, {
        status: 'PARTIAL',
        recordsFound: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        errorMessage: 'Không thu được bản ghi nào từ nguồn dữ liệu.',
      });

      return {
        jobId: job.id,
        source: usedFallback ? SOURCE.PLAYWRIGHT : SOURCE.APIFY,
        found: 0,
        saved: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        durationMs: Date.now() - startedAt,
        usedFallback,
      };
    }

    // Chuẩn hoá an toàn: bỏ qua từng item lỗi, không làm sập cả chu kỳ.
    const normalizeResult = normalizeRawItemsSafe(items);
    const normalized = sortByViewsDesc(normalizeResult.records);
    const skipped = Math.max(0, items.length - normalized.length - normalizeResult.failures.length);

    if (normalizeResult.failures.length > 0) {
      logger.warn(
        `Bỏ qua ${normalizeResult.failures.length} bản ghi lỗi định dạng khi chuẩn hoá (full-sync)`,
        normalizeResult.failures.slice(0, 5),
      );
    }

    const ingestResult = await ingestRecords(normalized, {
      jobId: job.id,
      source: usedFallback ? SOURCE.PLAYWRIGHT : SOURCE.APIFY,
      concurrency: env.scrape.concurrency,
      region,
    });

    const status =
      ingestResult.failed === 0 && skipped === 0
        ? 'COMPLETED'
        : ingestResult.saved + ingestResult.updated > 0
          ? 'PARTIAL'
          : 'FAILED';

    await markJobCompleted(job.id, {
      status,
      recordsFound: items.length,
      recordsSaved: ingestResult.saved,
      recordsUpdated: ingestResult.updated,
      recordsFailed: ingestResult.failed,
      errorMessage: ingestResult.errors.length > 0 ? ingestResult.errors.slice(0, 10).map((item) => item.message).join(' | ') : null,
      metadata: { usedFallback, skipped, truncatedErrors: ingestResult.errors.length },
    });

    return {
      jobId: job.id,
      source: usedFallback ? SOURCE.PLAYWRIGHT : SOURCE.APIFY,
      found: ingestResult.found,
      saved: ingestResult.saved,
      updated: ingestResult.updated,
      failed: ingestResult.failed,
      skipped: ingestResult.skipped + skipped,
      durationMs: Date.now() - startedAt,
      usedFallback,
    };
  } catch (error) {
    await markJobFailed(job.id, error);
    logger.error('Pipeline cào dữ liệu thất bại', error);
    throw error;
  }
}

async function fetchPlaywrightFallback(): Promise<RawTikTokItem[]> {
  const { fetchTikTokItemsViaPlaywright } = await import('./scraper/playwrightService.js');
  return fetchTikTokItemsViaPlaywright();
}
