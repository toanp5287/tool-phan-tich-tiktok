import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import type { RawTikTokItem } from '../../types/scraper.js';
import type { ShopScrapeConfig } from '../../types/targetedShop.js';
import { runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';

const logger = createLogger('apify-profile');

// ─── Cấu hình mặc định cho Profile Scraping ─────────────────────────────────
const DEFAULT_PROFILE_CONFIG = {
  resultsPerPage: 50,
  sections: ['videos', 'shop_products'] as const,
  profileSorting: 'latest' as const,
  timeoutSecs: 1200,
} satisfies Required<ShopScrapeConfig>;

// ─── RESIDENTIAL proxy để hạn chế bị TikTok chặn ────────────────────────────
const PROXY_CONFIGURATION = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
} as const;

export interface ProfileFetchOptions {
  profiles: string[];
  scrapeConfig?: ShopScrapeConfig;
  timeoutSecs?: number;
  maxAttempts?: number;
}

export interface ProfileFetchResult {
  items: RawTikTokItem[];
  runId: string;
  datasetId: string;
  profilesQueued: number;
  attempts: number;
}

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '');
}

function buildActorInput(options: ProfileFetchOptions): Record<string, unknown> {
  const cfg = options.scrapeConfig ?? {};

  const resultsPerPage = cfg.resultsPerPage ?? DEFAULT_PROFILE_CONFIG.resultsPerPage;
  const sections = cfg.sections ?? DEFAULT_PROFILE_CONFIG.sections;
  const profileSorting = cfg.profileSorting ?? DEFAULT_PROFILE_CONFIG.profileSorting;
  const normalizedProfiles = Array.from(
    new Set(options.profiles.map(normalizeUsername).filter(Boolean)),
  );

  logger.info(`Chuẩn bị Apify payload cho ${normalizedProfiles.length} profile`, {
    resultsPerPage,
    sections,
    profileSorting,
  });

  return {
    profiles: normalizedProfiles,
    profileScrapesSections: sections,
    profileSorting,
    resultsPerPage,
    proxyConfiguration: PROXY_CONFIGURATION,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    scrapeComments: false,
  };
}

function isUsableProfileItem(item: RawTikTokItem): boolean {
  const hasContent =
    typeof item.text === 'string' ||
    typeof item.desc === 'string' ||
    typeof item.title === 'string';
  const hasProduct =
    item.productInfo !== undefined ||
    item.product !== undefined ||
    item.shopName !== undefined ||
    item.shopId !== undefined;
  return hasContent || hasProduct;
}

/**
 * Gọi Apify Actor `clockworks/tiktok-scraper` theo chế độ Profile Scraping.
 * Retry tự động khi lỗi mạng hoặc dataset rỗng.
 */
export async function fetchTikTokProfileItems(options: ProfileFetchOptions): Promise<ProfileFetchResult> {
  if (options.profiles.length === 0) {
    throw new AppError('Danh sách profiles rỗng, không thể gọi Apify', 400, 'EMPTY_PROFILES');
  }

  const input = buildActorInput(options);
  const timeoutSecs =
    options.timeoutSecs ?? options.scrapeConfig?.timeoutSecs ?? DEFAULT_PROFILE_CONFIG.timeoutSecs;

  logger.info(`Gọi Apify actor ${env.apify.actorId} (profile mode)`, {
    profiles: options.profiles.length,
    timeoutSecs,
  });

  const result = await runActorAndFetchItems({
    actorId: env.apify.actorId,
    input,
    timeoutSecs,
    label: 'tiktok-profiles',
    maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
  });

  const valid = safelyFilterItems(result.items, isUsableProfileItem, 'profile-items').map((entry) => entry.item);

  logger.info(`Profile scrape xong: ${result.items.length} thô, ${valid.length} hợp lệ`, {
    runId: result.runId,
    datasetId: result.datasetId,
    profilesQueued: options.profiles.length,
    attempts: result.attempts,
  });

  return {
    items: valid,
    runId: result.runId,
    datasetId: result.datasetId,
    profilesQueued: options.profiles.length,
    attempts: result.attempts,
  };
}
