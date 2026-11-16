import { env } from '../config/env.js';
import { JOB_TRIGGER, JOB_TYPE, SOURCE } from '../config/constants.js';
import type { ScrapeRunResult, RawTikTokItem } from '../types/scraper.js';
import type { ProfileScrapeOptions, ProfileScrapeResult, ShopScrapeConfig } from '../types/targetedShop.js';
import { createLogger } from '../utils/logger.js';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { normalizeRawItemsSafe, sortByViewsDesc } from './scraper/normalizer.js';
import { fetchTikTokProfileItems } from './scraper/apifyProfileService.js';
import { ingestRecords } from './scraper/ingestionService.js';
import { createScrapeJob, markJobCompleted, markJobFailed } from './jobService.js';
import {
  getActiveProfileUsernames,
  markShopsFailed,
  markShopsScraped,
} from './targetedShopService.js';

const logger = createLogger('profile-scraper');

// ─── JOB_TYPE mới dành riêng cho Profile Sync ────────────────────────────────
export const PROFILE_SYNC_JOB_TYPE = 'PROFILE_SYNC' as const;

// ─── Single-flight guard (chỉ 1 phiên profile scrape tại 1 thời điểm) ────────
let activeProfileRun: Promise<ProfileScrapeResult> | null = null;

export function isProfileScrapeRunning(): boolean {
  return activeProfileRun !== null;
}

/**
 * Điểm vào công khai: khởi chạy pipeline cào theo Targeted Profile.
 * Đảm bảo single-flight: nếu đã có phiên đang chạy thì trả về promise hiện tại.
 */
export async function runProfileScrapePipeline(
  options: ProfileScrapeOptions = { trigger: JOB_TRIGGER.MANUAL },
): Promise<ProfileScrapeResult> {
  if (env.scrape.shopOnly) {
    throw new AppError('Profile scraping is disabled in strict TikTok Shop-only mode.', 403, 'SHOP_ONLY_MODE');
  }

  if (activeProfileRun && !options.force) {
    logger.warn('Bỏ qua: profile scrape pipeline đang chạy');
    return activeProfileRun;
  }

  activeProfileRun = executeProfilePipeline(options).finally(() => {
    activeProfileRun = null;
  });

  return activeProfileRun;
}

// ─── Private: toàn bộ pipeline logic ─────────────────────────────────────────

async function executeProfilePipeline(options: ProfileScrapeOptions): Promise<ProfileScrapeResult> {
  const startedAt = Date.now();
  const region = options.region ?? 'VN';

  // 1. Lấy danh sách shop active từ DB (lọc theo category/priority nếu có)
  const targetProfiles = await getActiveProfileUsernames({
    category: options.category,
    priority: options.priority,
    limit: env.apify.maxProfilesPerRun,
  });

  if (targetProfiles.length === 0) {
    logger.warn('Không có Targeted Shop nào active để cào. Kiểm tra bảng TargetedShop.');
    return {
      jobId: 0,
      source: SOURCE.APIFY,
      shopsQueued: 0,
      found: 0,
      saved: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  // 2. Tính scrapeConfig chung nhất để log (từng shop có config riêng sẽ override ở batch)
  const usernames = targetProfiles.map((p) => p.username);
  logger.info(`Bắt đầu Profile Scrape: ${usernames.length} shops`, {
    trigger: options.trigger,
    category: options.category ?? 'all',
    priority: options.priority ?? 'all',
  });

  // 3. Tạo ScrapeJob để tracking
  const job = await createScrapeJob({
    source: SOURCE.APIFY,
    jobType: PROFILE_SYNC_JOB_TYPE,
    trigger: options.trigger,
    region,
    metadata: {
      profiles: usernames,
      category: options.category ?? null,
      priority: options.priority ?? null,
      shopsQueued: usernames.length,
    },
  });

  try {
    // 4. Resolve scrapeConfig: dùng config chung hoặc merge per-shop configs
    // Khi nhiều shop cùng 1 batch → lấy config đầu tiên có giá trị (đơn giản hoá)
    // TODO: nếu muốn per-shop cực chi tiết → tách thành nhiều Apify call riêng lẻ
    const mergedConfig = resolveMergedConfig(targetProfiles);

    // 5. Gọi Apify với toàn bộ profile trong batch
    const apifyResult = await fetchTikTokProfileItems({
      profiles: usernames,
      scrapeConfig: mergedConfig,
      timeoutSecs: env.apify.timeoutSecs,
    });

    if (apifyResult.items.length === 0) {
      await markJobCompleted(job.id, {
        status: 'PARTIAL',
        recordsFound: 0,
        recordsSaved: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        errorMessage: 'Apify trả về 0 bản ghi từ các profile đã chỉ định.',
      });
      await markShopsFailed(usernames);

      return {
        jobId: job.id,
        source: SOURCE.APIFY,
        shopsQueued: usernames.length,
        found: 0,
        saved: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        durationMs: Date.now() - startedAt,
      };
    }

    // 6. Normalize raw → ScrapedRecord (an toàn từng item, lỗi 1 item không làm sập chu kỳ)
    const normalizeResult = normalizeRawItemsSafe(apifyResult.items);
    const normalized = sortByViewsDesc(normalizeResult.records);
    const skipped = Math.max(0, apifyResult.items.length - normalized.length - normalizeResult.failures.length);

    if (normalizeResult.failures.length > 0) {
      logger.warn(
        `Bỏ qua ${normalizeResult.failures.length} bản ghi lỗi định dạng khi chuẩn hoá (profile batch)`,
        normalizeResult.failures.slice(0, 5),
      );
    }

    // 7. Ingest vào DB
    const ingestResult = await ingestRecords(normalized, {
      jobId: job.id,
      source: SOURCE.APIFY,
      concurrency: env.scrape.concurrency,
      region,
    });

    // 8. Xác định status job
    const status =
      ingestResult.failed === 0 && skipped === 0
        ? 'COMPLETED'
        : ingestResult.saved + ingestResult.updated > 0
          ? 'PARTIAL'
          : 'FAILED';

    await markJobCompleted(job.id, {
      status,
       recordsFound: apifyResult.items.length,
      recordsSaved: ingestResult.saved,
      recordsUpdated: ingestResult.updated,
       recordsFailed: ingestResult.failed,
      errorMessage:
        ingestResult.errors.length > 0
          ? ingestResult.errors
              .slice(0, 10)
              .map((e) => e.message)
              .join(' | ')
          : null,
      metadata: {
        runId: apifyResult.runId,
        datasetId: apifyResult.datasetId,
         profilesQueued: apifyResult.profilesQueued,
        attempts: apifyResult.attempts,
        skipped,
      },
    });

    // 9. Cập nhật lastScrapedAt cho các shop đã cào thành công
    if (ingestResult.saved + ingestResult.updated > 0) await markShopsScraped(usernames);

    const result: ProfileScrapeResult = {
      jobId: job.id,
      source: SOURCE.APIFY,
      shopsQueued: usernames.length,
      found: ingestResult.found,
      saved: ingestResult.saved,
      updated: ingestResult.updated,
      failed: ingestResult.failed,
       skipped: ingestResult.skipped + skipped,
      durationMs: Date.now() - startedAt,
    };

    logger.info('Profile Scrape pipeline hoàn tất', result);
    return result;
  } catch (error) {
    await markJobFailed(job.id, error);
    await markShopsFailed(usernames);
    logger.error('Profile Scrape pipeline thất bại', toErrorMessage(error));
    throw error;
  }
}

/**
 * Merge scrapeConfig từ nhiều shop để dùng chung cho 1 Apify call.
 * Chiến lược: lấy giá trị lớn nhất của resultsPerPage, union các sections.
 */
function resolveMergedConfig(
  profiles: { scrapeConfig: ShopScrapeConfig | null }[],
): ShopScrapeConfig {
  let maxResultsPerPage = env.apify.profileResultsPerPage;
  const sectionsSet = new Set<string>(['videos', 'shop_products']);
  let profileSorting: 'latest' | 'popular' = 'latest';

  for (const profile of profiles) {
    const cfg = profile.scrapeConfig;
    if (!cfg) continue;
    if (cfg.resultsPerPage && cfg.resultsPerPage > maxResultsPerPage) {
      maxResultsPerPage = cfg.resultsPerPage;
    }
    if (cfg.sections) {
      cfg.sections.forEach((s) => sectionsSet.add(s));
    }
    if (cfg.profileSorting) profileSorting = cfg.profileSorting;
  }

  return {
    resultsPerPage: maxResultsPerPage,
    sections: Array.from(sectionsSet) as ShopScrapeConfig['sections'],
    profileSorting,
  };
}
