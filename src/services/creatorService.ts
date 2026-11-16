import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type {
  CreatorCard,
  CreatorDetail,
  CreatorListItem,
  CreatorProductItem,
  TrendVideoItem,
} from '../types/api.js';
import { AppError } from '../utils/errors.js';
import { buildAnalyticsWindow, isoDateKey, type AnalyticsWindow } from '../utils/dates.js';
import {
  bigIntToNumber,
  clampInt,
  decimalToNumber,
  percentChange,
  roundTo,
  safeDivide,
} from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';

const MAX_CREATOR_LINKS = 200;

export interface CreatorListFilters {
  search?: string;
  region?: string;
  role?: 'CREATOR' | 'AFFILIATE';
  sortBy?: 'gmv' | 'followers' | 'engagement' | 'sales';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  days?: number;
  anchor?: 'today' | 'yesterday';
}

type CreatorRow = Prisma.CreatorGetPayload<{
  include: {
    productLinks: {
      include: {
        product: { select: { id: true; title: true; imageUrl: true; category: true; minPrice: true } };
      };
    };
    snapshots: { select: { capturedAt: true; bucketDate: true; gmvTotal: true; followerCount: true; soldCount: true } };
    shopLinks: { include: { shop: { select: { id: true; name: true; avatarUrl: true } } } };
  };
}>;

function creatorInclude(windowStart: Date): {
  productLinks: {
    where: { isActive: true };
    orderBy: { gmvTotal: 'desc' };
    take: number;
    include: { product: { select: { id: true; title: true; imageUrl: true; category: true; minPrice: true } } };
  };
  snapshots: {
    where: { bucketDate: { gte: Date } };
    orderBy: { bucketDate: 'desc' };
    take: number;
    select: { capturedAt: true; bucketDate: true; gmvTotal: true; followerCount: true; soldCount: true };
  };
  shopLinks: {
    where: { isActive: true };
    orderBy: { gmvTotal: 'desc' };
    take: number;
    include: { shop: { select: { id: true; name: true; avatarUrl: true } } };
  };
} {
  return {
    productLinks: {
      where: { isActive: true },
      orderBy: { gmvTotal: 'desc' },
      take: MAX_CREATOR_LINKS,
      include: { product: { select: { id: true, title: true, imageUrl: true, category: true, minPrice: true } } },
    },
    snapshots: {
      where: { bucketDate: { gte: windowStart } },
      orderBy: { bucketDate: 'desc' },
      take: 2,
      select: { capturedAt: true, bucketDate: true, gmvTotal: true, followerCount: true, soldCount: true },
    },
    shopLinks: {
      where: { isActive: true },
      orderBy: { gmvTotal: 'desc' },
      take: 20,
      include: { shop: { select: { id: true, name: true, avatarUrl: true } } },
    },
  };
}

function toProductItem(
  product: { id: number; title: string; imageUrl: string | null; minPrice: Prisma.Decimal | null },
  gmv: number,
  sales: number,
): CreatorProductItem {
  return {
    id: product.id,
    title: product.title,
    imageUrl: product.imageUrl,
    price: decimalToNumber(product.minPrice) ?? 0,
    sales,
    gmv: roundTo(gmv, 0),
  };
}

/**
 * Chuyá»ƒn 1 Creator (kÃ¨m links + snapshots) thÃ nh card hiá»ƒn thá»‹.
 * GMV/sales láº¥y tá»« cá»™t aggregate; náº¿u null thÃ¬ cá»™ng dá»“n tá»« cÃ¡c liÃªn káº¿t sáº£n pháº©m.
 */
export function toCreatorCard(creator: CreatorRow): CreatorCard {
  const linkGmv = creator.productLinks.reduce((sum, link) => sum + (decimalToNumber(link.gmvTotal) ?? 0), 0);
  const linkSales = creator.productLinks.reduce((sum, link) => sum + (bigIntToNumber(link.soldCount) ?? 0), 0);

  const gmv = decimalToNumber(creator.gmvTotal) ?? linkGmv;
  const soldCount = bigIntToNumber(creator.soldCount) ?? linkSales;

  const latestSnapshot = creator.snapshots[0];
  const previousSnapshot = creator.snapshots[1];
  const currentGmv = decimalToNumber(latestSnapshot?.gmvTotal) ?? gmv;
  const previousGmv = decimalToNumber(previousSnapshot?.gmvTotal) ?? currentGmv;

  const followerCount =
    bigIntToNumber(creator.followerCount) ?? bigIntToNumber(latestSnapshot?.followerCount) ?? 0;
  const engagementRate = decimalToNumber(creator.engagementRate) ?? 0;

  const topProducts = creator.productLinks.slice(0, 3).map((link) =>
    toProductItem(link.product, decimalToNumber(link.gmvTotal) ?? 0, bigIntToNumber(link.soldCount) ?? 0),
  );

  return {
    id: creator.id,
    platformCreatorId: creator.platformCreatorId,
    username: creator.username,
    displayName: creator.displayName,
    avatarUrl: creator.avatarUrl,
    role: creator.role,
    followerCount,
    engagementRate,
    gmv: roundTo(gmv, 0),
    soldCount,
    videoCount: creator.videoCount ?? 0,
    growthRate: percentChange(currentGmv, previousGmv),
    topProducts,
  };
}

/* ------------------------------------------------------------------ */
/* Danh sÃ¡ch creator                                                   */
/* ------------------------------------------------------------------ */

export async function listCreators(filters: CreatorListFilters): Promise<{ items: CreatorListItem[]; total: number }> {
  const days = clampInt(filters.days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const windowStart = buildAnalyticsWindow(days, new Date(), filters.anchor ?? 'today').currentStart;

  const where: Prisma.CreatorWhereInput = {};
  if (filters.search) {
    where.OR = [
      { displayName: { contains: filters.search, mode: 'insensitive' } },
      { username: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.region) where.region = filters.region;
  if (filters.role) where.role = filters.role;

  const total = await prisma.creator.count({ where });

  const orderBy = resolveCreatorOrder(filters.sortBy, filters.sortDir);

  const rows = await prisma.creator.findMany({
    where,
    include: creatorInclude(windowStart),
    orderBy,
    skip: (filters.page - 1) * filters.pageSize,
    take: filters.pageSize,
  });

  return { items: rows.map(toCreatorCard), total };
}

function resolveCreatorOrder(
  sortBy: CreatorListFilters['sortBy'],
  sortDir: 'asc' | 'desc' = 'desc',
): Prisma.CreatorOrderByWithRelationInput[] {
  const direction = sortDir;
  switch (sortBy) {
    case 'followers':
      return [{ followerCount: { sort: direction, nulls: 'last' } }, { id: 'desc' }];
    case 'engagement':
      return [{ engagementRate: { sort: direction, nulls: 'last' } }, { id: 'desc' }];
    case 'sales':
      return [{ soldCount: { sort: direction, nulls: 'last' } }, { id: 'desc' }];
    case 'gmv':
    default:
      return [{ gmvTotal: { sort: direction, nulls: 'last' } }, { followerCount: { sort: 'desc', nulls: 'last' } }];
  }
}

/* ------------------------------------------------------------------ */
/* Chi tiáº¿t creator                                                    */
/* ------------------------------------------------------------------ */

export async function getCreatorDetail(
  creatorId: number,
  days: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<CreatorDetail> {
  const safeDays = clampInt(days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(safeDays, new Date(), anchor);

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: {
      ...creatorInclude(window.currentStart),
      snapshots: {
        where: { bucketDate: { gte: window.previousStart } },
        orderBy: { bucketDate: 'asc' },
        select: { capturedAt: true, bucketDate: true, gmvTotal: true, followerCount: true, soldCount: true },
      },
    },
  });

  if (!creator) throw AppError.notFound(`KhÃ´ng tÃ¬m tháº¥y nhÃ  sÃ¡ng táº¡o #${creatorId}`);

  const card = toCreatorCard(creator as CreatorRow);

  const timeline = buildCreatorTimeline(creator.snapshots, window);

  const trendVideos = await prisma.trendItem.findMany({
    where: { creatorId },
    orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
    take: 6,
  });

  return {
    ...card,
    bio: creator.bio,
    region: creator.region,
    firstSeenAt: toIso(creator.firstSeenAt),
    lastSeenAt: toIso(creator.lastSeenAt),
    products: creator.productLinks.map((link) => ({
      ...toProductItem(link.product, decimalToNumber(link.gmvTotal) ?? 0, bigIntToNumber(link.soldCount) ?? 0),
      category: link.product.category,
      shopName: creator.shopLinks[0]?.shop.name ?? 'TikTok Shop',
    })),
    shops: creator.shopLinks.map((link) => ({
      id: link.shop.id,
      name: link.shop.name,
      avatarUrl: link.shop.avatarUrl,
      gmv: roundTo(decimalToNumber(link.gmvTotal) ?? 0, 0),
    })),
    timeline,
    trendVideos: trendVideos.map(toTrendVideo),
  };
}

function buildCreatorTimeline(
  snapshots: Array<{ capturedAt: Date; bucketDate?: Date; gmvTotal: Prisma.Decimal | null; followerCount: bigint | null; soldCount: bigint | null }>,
  window: AnalyticsWindow,
): Array<{ date: string; gmv: number; followers: number; soldCount: number }> {
  const byDay = new Map<string, { gmv: number; followers: number; soldCount: number }>();

  for (const snapshot of snapshots) {
    const key = isoDateKey(snapshot.bucketDate ?? snapshot.capturedAt);
    if (new Date(key).getTime() < window.currentStart.getTime()) continue;
    byDay.set(key, {
      gmv: decimalToNumber(snapshot.gmvTotal) ?? 0,
      followers: bigIntToNumber(snapshot.followerCount) ?? 0,
      soldCount: bigIntToNumber(snapshot.soldCount) ?? 0,
    });
  }

  const lastKnown = { gmv: 0, followers: 0, soldCount: 0 };
  return window.daysList.map((day) => {
    const key = isoDateKey(day);
    const point = byDay.get(key);
    if (point) {
      lastKnown.gmv = point.gmv;
      lastKnown.followers = point.followers;
      lastKnown.soldCount = point.soldCount;
    }
    return { date: key, ...lastKnown };
  });
}

/* ------------------------------------------------------------------ */
/* Creator cho trang chá»§ / sáº£n pháº©m / shop                             */
/* ------------------------------------------------------------------ */

export async function getTopCreators(
  limit = 10,
  days: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<CreatorCard[]> {
  const safeLimit = clampInt(limit, 1, 100, 10);
  const windowStart = buildAnalyticsWindow(days, new Date(), anchor).currentStart;

  const rows = await prisma.creator.findMany({
    include: creatorInclude(windowStart),
    orderBy: [{ gmvTotal: { sort: 'desc', nulls: 'last' } }, { followerCount: { sort: 'desc', nulls: 'last' } }],
    take: safeLimit,
  });

  return rows.map(toCreatorCard);
}

/** Top creator bÃ¡n má»™t sáº£n pháº©m cá»¥ thá»ƒ. */
export async function getProductCreators(
  productId: number,
  limit = 10,
  days: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<CreatorCard[]> {
  const safeLimit = clampInt(limit, 1, 50, 10);
  const windowStart = buildAnalyticsWindow(days, new Date(), anchor).currentStart;

  const links = await prisma.productCreator.findMany({
    where: { productId, isActive: true },
    orderBy: [{ gmvTotal: { sort: 'desc', nulls: 'last' } }, { soldCount: { sort: 'desc', nulls: 'last' } }],
    take: safeLimit,
    select: { creatorId: true },
  });

  if (links.length === 0) return [];

  const ids = links.map((link) => link.creatorId);
  const creators = await prisma.creator.findMany({
    where: { id: { in: ids } },
    include: creatorInclude(windowStart),
  });

  const byId = new Map(creators.map((creator) => [creator.id, creator]));
  return ids
    .map((id) => byId.get(id))
    .filter((creator): creator is CreatorRow => Boolean(creator))
    .map(toCreatorCard);
}

/** Top affiliate cá»§a má»™t shop. */
export async function getShopAffiliates(
  shopId: number,
  limit = 10,
  days: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<CreatorCard[]> {
  const safeLimit = clampInt(limit, 1, 50, 10);
  const windowStart = buildAnalyticsWindow(days, new Date(), anchor).currentStart;

  const links = await prisma.creatorShop.findMany({
    where: { shopId, isActive: true },
    orderBy: [{ gmvTotal: { sort: 'desc', nulls: 'last' } }, { soldCount: { sort: 'desc', nulls: 'last' } }],
    take: safeLimit,
    select: { creatorId: true },
  });

  if (links.length === 0) return [];

  const ids = links.map((link) => link.creatorId);
  const creators = await prisma.creator.findMany({
    where: { id: { in: ids } },
    include: creatorInclude(windowStart),
  });

  const byId = new Map(creators.map((creator) => [creator.id, creator]));
  return ids
    .map((id) => byId.get(id))
    .filter((creator): creator is CreatorRow => Boolean(creator))
    .map(toCreatorCard);
}

/** Video xu hÆ°á»›ng cá»§a má»™t sáº£n pháº©m (Top Trend Video). */
export async function getProductTrendVideos(productId: number, limit = 5): Promise<TrendVideoItem[]> {
  const rows = await prisma.trendItem.findMany({
    where: { productId },
    orderBy: [{ playCount: { sort: 'desc', nulls: 'last' } }, { scrapedAt: 'desc' }],
    take: clampInt(limit, 1, 24, 5),
  });

  return rows.map(toTrendVideo);
}

export function toTrendVideo(row: {
  id: number;
  platformVideoId: string | null;
  content: string;
  author: string | null;
  videoUrl: string | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  commentCount: bigint | null;
  scrapedAt: Date;
}): TrendVideoItem {
  const playCount = bigIntToNumber(row.playCount) ?? 0;
  const diggCount = bigIntToNumber(row.diggCount) ?? 0;
  const shareCount = bigIntToNumber(row.shareCount) ?? 0;
  const commentCount = bigIntToNumber(row.commentCount) ?? 0;
  const engagementRate = playCount > 0 ? safeDivide((diggCount + shareCount + commentCount) * 100, playCount) : 0;

  return {
    id: row.id,
    platformVideoId: row.platformVideoId,
    content: row.content,
    author: row.author,
    videoUrl: row.videoUrl,
    playCount,
    diggCount,
    shareCount,
    commentCount,
    engagementRate: roundTo(engagementRate, 2),
    scrapedAt: toIso(row.scrapedAt),
  };
}
