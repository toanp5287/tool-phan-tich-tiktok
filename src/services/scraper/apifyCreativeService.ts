import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { toOptionalNumber } from '../../utils/numbers.js';
import type { RawTikTokItem } from '../../types/scraper.js';
import { runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';

const logger = createLogger('apify-creative');

/**
 * Actor mặc định cho TikTok Creative Center.
 * Có thể override bằng APIFY_CREATIVE_ACTOR.
 */
const DEFAULT_CREATIVE_ACTOR = 'memo23/tiktok-creative-center-scraper';

export type CreativeSection = 'creators' | 'products' | 'videos' | 'trends';

export interface CreativeFetchOptions {
  sections?: CreativeSection[];
  region?: string;
  period?: '7' | '30' | '90' | '120';
  resultsPerPage?: number;
  timeoutSecs?: number;
  maxAttempts?: number;
}

export interface CreativeFetchResult {
  items: RawTikTokItem[];
  runId: string;
  datasetId: string;
  sections: CreativeSection[];
  attempts: number;
}

export function getCreativeActorId(): string {
  return env.apify.creativeActor || DEFAULT_CREATIVE_ACTOR;
}

function buildActorInput(options: CreativeFetchOptions): Record<string, unknown> {
  const sections = options.sections ?? ['creators', 'products', 'videos'];
  const region = options.region ?? 'VN';
  const period = options.period ?? '30';
  const resultsPerPage = options.resultsPerPage ?? env.apify.profileResultsPerPage;

  return {
    sections,
    countryCode: region,
    period,
    resultsPerPage,
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  };
}

/**
 * Gọi Apify Actor TikTok Creative Center để thu thập creator/product/video trends.
 * Retry tự động khi lỗi mạng hoặc dataset rỗng.
 */
export async function fetchCreativeCenterItems(
  options: CreativeFetchOptions = {},
): Promise<CreativeFetchResult> {
  const actorId = getCreativeActorId();
  const input = buildActorInput(options);
  const timeoutSecs = options.timeoutSecs ?? env.apify.timeoutSecs;
  const sections = (input.sections as CreativeSection[]) ?? ['creators'];

  logger.info(`Gọi Apify Creative Center actor ${actorId}`, { sections, region: input.countryCode });

  const result = await runActorAndFetchItems({
    actorId,
    input,
    timeoutSecs,
    label: 'tiktok-creative',
    maxAttempts: options.maxAttempts ?? env.apify.maxAttempts,
  });

  const valid = safelyFilterItems(
    result.items,
    (item) => Boolean(item) && typeof item === 'object',
    'creative-items',
  ).map((entry) => entry.item);

  logger.info(`Creative Center trả về ${result.items.length} thô, ${valid.length} hợp lệ`, {
    runId: result.runId,
    datasetId: result.datasetId,
    attempts: result.attempts,
  });

  return {
    items: valid,
    runId: result.runId,
    datasetId: result.datasetId,
    sections,
    attempts: result.attempts,
  };
}

export interface CreativeCreatorInput {
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  followerCount: number | null;
  engagementRate: number | null;
  gmvTotal: number | null;
  soldCount: number | null;
  videoCount: number | null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Chuẩn hoá item Creative Center -> creator record.
 * Hỗ trợ nhiều biến thể field name khác nhau của các Actor Creative Center.
 */
export function normalizeCreativeCreator(item: RawTikTokItem): CreativeCreatorInput | null {
  const source = (item.creator && typeof item.creator === 'object' ? item.creator : item) as Record<string, unknown>;

  const platformCreatorId = pickString(source.id, source.userId, source.creatorId, source.uid, item.authorMeta?.id);
  const displayName = pickString(
    source.nickname,
    source.nickName,
    source.displayName,
    source.name,
    item.authorMeta?.nickName,
  );

  if (!platformCreatorId || !displayName) return null;

  const followerCount = toOptionalNumber(
    source.followerCount ?? source.followers ?? source.fans ?? item.authorMeta?.fans,
  );
  const engagementRate = toOptionalNumber(
    source.engagementRate ?? source.engagement ?? source.interactionRate,
  );
  const gmvTotal = toOptionalNumber(source.gmv ?? source.gmvTotal ?? source.revenue ?? source.salesAmount);
  const soldCount = toOptionalNumber(source.soldCount ?? source.sales ?? source.unitsSold);
  const videoCount = toOptionalNumber(source.videoCount ?? source.videos ?? source.awemeCount);

  return {
    platformCreatorId,
    username: pickString(source.uniqueId, source.username, source.handle)?.replace(/^@/, '') ?? null,
    displayName,
    avatarUrl: pickString(source.avatar, source.avatarUrl, source.avatarThumb, item.authorMeta?.avatar),
    followerCount,
    engagementRate,
    gmvTotal,
    soldCount,
    videoCount,
  };
}
