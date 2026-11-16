import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { createLogger } from '../../utils/logger.js';
import type { RawTikTokItem } from '../../types/scraper.js';
import { getApifyClient, runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';

const logger = createLogger('apify');

export const DEFAULT_TARGET_PROFILES = [
  'thegioiskinfood',
  'hieunguyenskincare',
  'chicland_official',
  'totodaofficial',
] as const;

export interface ApifyFetchOptions {
  profiles?: string[];
  searchQueries?: string[];
  resultsPerPage?: number;
  timeoutSecs?: number;
  maxAttempts?: number;
}

export interface ApifyFetchResult {
  items: RawTikTokItem[];
  runId: string;
  datasetId: string;
  profiles: string[];
  attempts: number;
}

const PROXY_CONFIGURATION = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
} as const;

function normalizeProfiles(profiles: readonly string[]): string[] {
  return Array.from(
    new Set(
      profiles
        .map((profile) => profile.trim().replace(/^@/, ''))
        .filter((profile) => profile.length > 0),
    ),
  );
}

function normalizeQueries(queries: readonly string[]): string[] {
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

/** Item thô hợp lệ tối thiểu: có nội dung hoặc id video. */
function isUsableItem(item: RawTikTokItem): boolean {
  const hasContent =
    typeof item.text === 'string' ||
    typeof item.desc === 'string' ||
    typeof item.title === 'string';
  const hasId = item.id !== undefined || item.aweme_id !== undefined;
  return hasContent || hasId;
}

/**
 * Gọi Apify Actor clockworks/tiktok-scraper theo danh sách profiles và lấy toàn bộ item.
 * Có retry tối đa `APIFY_MAX_ATTEMPTS` lần khi lỗi mạng hoặc dataset rỗng.
 */
export async function fetchTikTokItems(options: ApifyFetchOptions = {}): Promise<ApifyFetchResult> {
  const sourceProfiles =
    options.profiles && options.profiles.length > 0
      ? options.profiles
      : env.apify.profiles.length > 0
        ? env.apify.profiles
        : DEFAULT_TARGET_PROFILES;

  const profiles = normalizeProfiles(sourceProfiles);
  const searchQueries = normalizeQueries(options.searchQueries ?? env.apify.searchQueries);

  if (profiles.length === 0 && searchQueries.length === 0) {
    throw new AppError('Danh sách profiles/search queries rỗng, không thể gọi Apify Actor.', 400, 'EMPTY_TARGETS');
  }

  const input = {
    profiles,
    searchQueries,
    resultsPerPage: options.resultsPerPage ?? env.apify.resultsPerPage,
    proxyConfiguration: PROXY_CONFIGURATION,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
  };

  logger.info(`Chuẩn bị gọi Apify actor ${env.apify.actorId}`, {
    profilesCount: profiles.length,
    searchQueriesCount: searchQueries.length,
    maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
  });

  const result = await runActorAndFetchItems({
    actorId: env.apify.actorId,
    input,
    timeoutSecs: options.timeoutSecs ?? env.apify.timeoutSecs,
    label: 'tiktok-search',
    maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
  });

  const valid = safelyFilterItems(result.items, isUsableItem, 'apify-items').map((entry) => entry.item);

  logger.info(`Apify trả về ${result.items.length} bản ghi, ${valid.length} hợp lệ`, {
    runId: result.runId,
    datasetId: result.datasetId,
    attempts: result.attempts,
  });

  return {
    items: valid,
    runId: result.runId,
    datasetId: result.datasetId,
    profiles,
    attempts: result.attempts,
  };
}
