import { runShopScrapePipeline } from '../services/shopScrapeService.js';
import { env } from '../config/env.js';
import { disconnectDatabase } from '../config/db.js';
import { createLogger } from '../utils/logger.js';
import { formatDuration } from '../utils/dates.js';

const logger = createLogger('cli:scrape');
const ESTIMATED_SHOP_PRICE_PER_ITEM_USD = 0.012;
const ESTIMATED_CREATOR_PRICE_PER_PROFILE_USD = 0.006;
const MONTHLY_SHOP_CAP_USD = 5;

async function main(): Promise<void> {
  logger.info('Chạy cào dữ liệu TikTok Shop thủ công (một lần)', {
    actor: env.apify.shopActorId,
    keywords: env.apify.shopKeywords.length,
    maxItems: env.apify.shopMaxItemsPerRun,
  });

  const requestedItems = Math.min(30, Math.max(1, env.apify.shopMaxItemsPerRun));
  const estimatedMaxCostUsd =
    requestedItems * ESTIMATED_SHOP_PRICE_PER_ITEM_USD +
    env.apify.creatorSearchMaxProfiles * ESTIMATED_CREATOR_PRICE_PER_PROFILE_USD;
  logger.info('[Cost Watcher] Ước tính chi phí tối đa lần chạy', {
    requestedItems,
    creatorProfilesMax: env.apify.creatorSearchMaxProfiles,
    estimatedMaxCostUsd: Number(estimatedMaxCostUsd.toFixed(3)),
    maxFullRunsUnderFiveDollars: Math.floor(MONTHLY_SHOP_CAP_USD / estimatedMaxCostUsd),
    pricingNote:
      'Shop $12/1.000 kết quả; creator search $6/1.000 profile (free plan). Đối chiếu giá Actor hiện hành trước khi chạy.',
  });

  // Task lock (in-process + file lock) được pipeline tự quản lý.
  // Nếu tiến trình khác đang cào, jobId = 0 và không phát sinh chi phí.
  const result = await runShopScrapePipeline({ trigger: 'cli' });

  if (result.jobId === 0) {
    logger.warn(
      'Không chạy được phiên cào: đã có tiến trình/phiên khác đang chiếm task lock. Không phát sinh chi phí Apify.',
    );
    return;
  }

  const billableShopItems = result.rawCount ?? result.found;
  // Actor charges for usable result profiles even if DB persistence fails.
  const billableCreatorProfiles = result.creatorProfilesFound ?? 0;
  const estimatedActualCostUsd =
    billableShopItems * ESTIMATED_SHOP_PRICE_PER_ITEM_USD +
    billableCreatorProfiles * ESTIMATED_CREATOR_PRICE_PER_PROFILE_USD;

  logger.info(`Hoàn tất sau ${formatDuration(result.durationMs)}`, {
    jobId: result.jobId,
    source: result.source,
    keywords: result.keywords.length,
    found: result.found,
    saved: result.saved,
    updated: result.updated,
    failed: result.failed,
    skipped: result.skipped,
    rawCount: result.rawCount,
    creatorProfilesSaved: result.creatorProfilesSaved,
    billableShopItems,
    billableCreatorProfiles,
    estimatedActualCostUsd: Number(estimatedActualCostUsd.toFixed(3)),
  });
}

main()
  .catch((error) => {
    logger.error('Cào dữ liệu TikTok Shop thất bại', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
