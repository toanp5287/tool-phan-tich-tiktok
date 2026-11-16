import { CreatorRole } from '@prisma/client';
import prisma from '../../config/db.js';
import { env } from '../../config/env.js';
import { SOURCE } from '../../config/constants.js';
import { createLogger } from '../../utils/logger.js';
import { toBucketDate } from '../../utils/dates.js';
import { toOptionalBigInt } from '../../utils/numbers.js';
import { runActorAndFetchItems, safelyFilterItems } from './apifyCore.js';
import type { RawTikTokItem } from '../../types/scraper.js';

const logger = createLogger('creator-search');

interface CreatorSearchItem extends RawTikTokItem {
  name?: string;
  nickName?: string;
  avatar?: string;
  fans?: number | string;
  video?: number | string;
  signature?: string;
  ttSeller?: boolean;
  error?: string;
  errorCode?: string;
}

export interface CreatorDiscoveryResult {
  found: number;
  saved: number;
  failed: number;
  queries: string[];
}

function positiveInt(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildQueries(records: readonly { shop: { name: string }; product: { category: string | null; title: string } }[]): string[] {
  const queries = new Set<string>();
  for (const record of records) {
    const shopName = text(record.shop.name);
    if (shopName) queries.add(shopName);
    const category = text(record.product.category);
    if (category) queries.add(category);
    if (queries.size >= 10) break;
  }
  return [...queries].slice(0, 10);
}

/** Search public TikTok profiles using only shop/category terms from this scrape. */
export async function discoverCreatorsFromShopRecords(
  records: Parameters<typeof buildQueries>[0],
  scrapeJobId: number,
  maxProfiles: number,
): Promise<CreatorDiscoveryResult> {
  const cap = Math.min(30, Math.max(0, Math.trunc(maxProfiles)));
  // Actor result billing is per profile, so bound requested queries as well as
  // the dataset download cap (the Actor may return results before truncation).
  const queries = buildQueries(records).slice(0, cap);
  if (!env.apify.token || !queries.length || cap === 0) return { found: 0, saved: 0, failed: 0, queries };

  const maxProfilesPerQuery = Math.max(1, Math.floor(cap / queries.length));
  const result = await runActorAndFetchItems({
    actorId: env.apify.creatorSearchActor,
    input: { searchQueries: queries, maxProfilesPerQuery },
    timeoutSecs: env.apify.timeoutSecs,
    label: 'creator-profile-search',
    maxAttempts: 1,
    maxItems: cap,
  });

  const usable = safelyFilterItems(result.items, (raw) => {
    const item = raw as CreatorSearchItem;
    return !item.errorCode && Boolean(text(item.id) ?? text(item.username) ?? text(item.uniqueId)) &&
      Boolean(text(item.nickName) ?? text(item.nickname) ?? text(item.name));
  }, 'creator-search-results').map(({ item }) => item as CreatorSearchItem);

  const bucketDate = toBucketDate(new Date());
  const seen = new Set<string>();
  let saved = 0;
  let failed = 0;

  for (const item of usable) {
    const platformCreatorId = text(item.id) ?? text(item.userId) ?? text(item.uniqueId) ?? text(item.username);
    const displayName = text(item.nickName) ?? text(item.nickname) ?? text(item.name);
    if (!platformCreatorId || !displayName || seen.has(platformCreatorId)) continue;
    seen.add(platformCreatorId);

    const username = (text(item.uniqueId) ?? text(item.username))?.replace(/^@/, '') ?? null;
    const avatarUrl = text(item.avatar) ?? text(item.avatarUrl);
    const followerCount = positiveInt(item.fans ?? item.followerCount ?? item.followers);
    const videoCount = positiveInt(item.video ?? item.videoCount ?? item.awemeCount);
    const rawData = {
      id: platformCreatorId,
      username,
      displayName,
      avatarUrl,
      followerCount,
      videoCount,
      signature: text(item.signature),
      ttSeller: item.ttSeller === true,
      searchQueries: queries,
    };

    try {
      await prisma.$transaction(async (tx) => {
        const creator = await tx.creator.upsert({
          where: {
            platformCreatorId_source: {
              platformCreatorId,
              source: SOURCE.CREATOR_DISCOVERY,
            },
          },
          update: {
            displayName,
            ...(username ? { username } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(followerCount !== null ? { followerCount: toOptionalBigInt(followerCount) } : {}),
            ...(videoCount !== null ? { videoCount } : {}),
            ...(text(item.signature) ? { bio: text(item.signature) } : {}),
            lastSeenAt: new Date(),
          },
          create: {
            platformCreatorId,
            source: SOURCE.CREATOR_DISCOVERY,
            username,
            displayName,
            avatarUrl,
            bio: text(item.signature),
            role: CreatorRole.CREATOR,
            region: 'VN',
            followerCount: toOptionalBigInt(followerCount),
            videoCount,
          },
          select: { id: true },
        });

        await tx.creatorSnapshot.upsert({
          where: { creatorId_source_bucketDate: { creatorId: creator.id, source: SOURCE.CREATOR_DISCOVERY, bucketDate } },
          update: {
            followerCount: toOptionalBigInt(followerCount),
            videoCount,
            rawData,
            isEstimated: false,
          },
          create: {
            creatorId: creator.id,
            scrapeJobId,
            source: SOURCE.CREATOR_DISCOVERY,
            bucketDate,
            followerCount: toOptionalBigInt(followerCount),
            videoCount,
            rawData,
            isEstimated: false,
          },
        });
      });
      saved += 1;
    } catch (error) {
      failed += 1;
      if (failed <= 5) logger.warn(`Could not persist discovered profile ${platformCreatorId}`, error);
    }
  }

  logger.info('Creator profile discovery complete', { found: usable.length, saved, failed, queries: queries.length });
  return { found: usable.length, saved, failed, queries };
}
