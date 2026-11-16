import type { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { listShops } from '../../services/shopService.js';
import { buildAnalyticsWindow } from '../../utils/dates.js';
import { bigIntToNumber, decimalToNumber, roundTo, safeDivide } from '../../utils/numbers.js';
import {
  buildMultiPeriodAggregate,
  createAccumulator,
  accumulate,
  currentAnchor,
  periodWindows,
  valueAt,
} from './metrics.js';
import { aggregateShopRevenue, type RevenueAggregate } from './revenue.js';
import {
  buildProductGrowth,
  emptyGrowth,
  toCumulativePoint,
  toProductCard,
  toTrendVideo,
} from './commerceRepository.js';
import type {
  MultiPeriodMetrics,
  RangeMeta,
  ShopCommerceCreatorCard,
  ShopCommerceProductCard,
  ShopCommerceShopCard,
  ShopCommerceShopDetail,
} from './shopCommerceTypes.js';

const REGION = 'VN';
const MAX_PRODUCTS_FOR_DETAIL = 300;

/**
 * Include dùng chung cho shop: chỉ các cột thương mại, không có trường legacy.
 * Snapshot shop-product không cần rating/tồn kho vì đã có trên Product.
 */
const SHOP_INCLUDE = {
  productShops: {
    where: { isActive: true },
    include: {
      product: {
        include: {
          productShops: {
            where: { isActive: true },
            orderBy: { lastSeenAt: 'desc' },
            take: 1,
            select: { shop: { select: { id: true, name: true, avatarUrl: true } } },
          },
        },
      },
      snapshots: {
        select: {
          bucketDate: true,
          capturedAt: true,
          gmvTotal: true,
          soldCountTotal: true,
          price: true,
          playCount: true,
          diggCount: true,
          shareCount: true,
          commentCount: true,
        },
        orderBy: { bucketDate: 'asc' as const },
      },
    },
  },
  revenueSnapshots: {
    select: {
      bucketDate: true,
      gmvVideo: true,
      gmvLive: true,
      gmvCart: true,
      gmvProductCard: true,
      gmvTotal: true,
      isEstimated: true,
    },
    orderBy: { bucketDate: 'desc' as const },
    take: 180,
  },
} satisfies Prisma.ShopInclude;

type ShopWithCommerce = Prisma.ShopGetPayload<{ include: typeof SHOP_INCLUDE }>;
type TrackingWithCommerce = ShopWithCommerce['productShops'][number];

function growthFromTrackings(
  trackings: readonly TrackingWithCommerce[],
  now: Date,
  range: RangeMeta,
): MultiPeriodMetrics {
  const windows = periodWindows(now, range.anchor);
  const accumulators = new Map<number, ReturnType<typeof createAccumulator>>();
  for (const window of windows) accumulators.set(window.days, createAccumulator());

  for (const tracking of trackings) {
    const series = tracking.snapshots.map(toCumulativePoint);
    for (const window of windows) {
      const acc = accumulators.get(window.days);
      if (acc) accumulate(acc, series, window);
    }
  }

  return buildMultiPeriodAggregate(accumulators, windows, range.days);
}

function trackingToCard(
  tracking: TrackingWithCommerce,
  now: Date,
  range: RangeMeta,
  shopName: string,
): ShopCommerceProductCard {
  const series = tracking.snapshots.map(toCumulativePoint);
  const latest = valueAt(series, currentAnchor(now, range.anchor));

  return toProductCard(
    tracking.product,
    { productId: tracking.productId, series, latest, previous: null },
    buildProductGrowth({ productId: tracking.productId, series, latest, previous: null }, now, range),
    shopName,
  );
}

function normalizeRevenue(revenue: RevenueAggregate): ShopCommerceShopCard['revenueSources'] {
  return {
    video: revenue.video,
    live: revenue.live,
    cart: revenue.cart,
    productCard: revenue.productCard,
    total: revenue.total,
    videoShare: revenue.videoShare,
    liveShare: revenue.liveShare,
    cartShare: revenue.cartShare,
    productCardShare: revenue.productCardShare,
    isEstimated: revenue.isEstimated,
  };
}

function toShopCard(shop: ShopWithCommerce, now: Date, range: RangeMeta): ShopCommerceShopCard {
  const today = currentAnchor(now, range.anchor);
  const latestPoints = shop.productShops
    .map((tracking) => valueAt(tracking.snapshots.map(toCumulativePoint), today))
    .filter((point): point is NonNullable<typeof point> => point !== null);

  const totalSales = latestPoints.reduce((sum, point) => sum + point.sold, 0);
  const totalGmv = latestPoints.reduce((sum, point) => sum + point.gmv, 0);
  const pricePoints = latestPoints.filter((point) => point.price > 0);
  const priceSum = pricePoints.reduce((sum, point) => sum + point.price, 0);

  const growth = growthFromTrackings(shop.productShops, now, range);

  return {
    id: shop.id,
    platformShopId: shop.platformShopId,
    name: shop.name,
    username: shop.username,
    avatarUrl: shop.avatarUrl,
    bannerUrl: shop.bannerUrl,
    shopUrl: shop.shopUrl,
    productCount: shop.productShops.length,
    followerCount: bigIntToNumber(shop.followerCount),
    ratingScore: decimalToNumber(shop.ratingScore),
    ratingCount: bigIntToNumber(shop.ratingCount),
    totalGmv: roundTo(totalGmv, 0),
    totalSales,
    avgOrderValue: totalSales > 0 ? roundTo(safeDivide(totalGmv, totalSales), 0) : 0,
    avgPrice: pricePoints.length > 0 ? roundTo(safeDivide(priceSum, pricePoints.length), 0) : 0,
    growthRate: growth.primary.gmv.growthRate,
    growth,
    revenueSources: normalizeRevenue(aggregateShopRevenue(shop.revenueSnapshots)),
    lastSeenAt: shop.lastSeenAt.toISOString(),
    topProducts: shop.productShops
      .map((tracking) => trackingToCard(tracking, now, range, shop.name))
      .sort((a, b) => b.soldCount - a.soldCount || b.gmv - a.gmv)
      .slice(0, 10),
  };
}

export interface ShopQuery {
  search?: string;
  sortBy?: 'gmv' | 'sales' | 'products' | 'recent';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  range: RangeMeta;
}

export async function listCommerceShops(query: ShopQuery): Promise<{ items: ShopCommerceShopCard[]; total: number }> {
  const now = new Date();
  const where: Prisma.ShopWhereInput = { region: REGION };

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { username: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const canonical = await listShops({ ...query, region: REGION, days: query.range.days, anchor: query.range.anchor });
  const total = canonical.total;

  const orderBy: Prisma.ShopOrderByWithRelationInput[] =
    query.sortBy === 'recent'
      ? [{ lastSeenAt: 'desc' }]
      : [{ gmvTotal: query.sortDir === 'asc' ? 'asc' : 'desc' }, { lastSeenAt: 'desc' }];

  const shops = await prisma.shop.findMany({
    where: { id: { in: canonical.items.map((item) => item.id) } },
    include: SHOP_INCLUDE,
    orderBy,
  });

  let items = shops.map((shop) => toShopCard(shop, now, query.range));

  if (query.sortBy === 'sales' || query.sortBy === 'products') {
    const direction = query.sortDir === 'asc' ? 1 : -1;
    const accessor =
      query.sortBy === 'sales'
        ? (item: ShopCommerceShopCard) => item.totalSales
        : (item: ShopCommerceShopCard) => item.productCount;
    items = items.sort((a, b) => (accessor(a) - accessor(b)) * direction);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  return { items: canonical.items.flatMap((item) => {
    const card = byId.get(item.id);
    return card ? [{ ...card, totalGmv: item.totalGmv, totalSales: item.totalSales, productCount: item.productCount }] : [];
  }), total };
}

export async function getCommerceShopDetail(
  shopId: number,
  range: RangeMeta,
): Promise<ShopCommerceShopDetail> {
  const now = new Date();
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, region: REGION },
    include: SHOP_INCLUDE,
  });

  if (!shop) {
    const error = new Error(`Không tìm thấy shop TikTok Shop VN #${shopId}`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
    (error as Error & { code?: string }).code = 'NOT_FOUND';
    throw error;
  }

  const card = toShopCard(shop, now, range);
  const productIds = shop.productShops.slice(0, MAX_PRODUCTS_FOR_DETAIL).map((tracking) => tracking.productId);
  const newProductCutoff = new Date(now.getTime() - 14 * 86_400_000);

  const [affiliates, videos, newProductRows] = await Promise.all([
    loadShopAffiliates(shop.id, now, range, 10),
    prisma.trendItem.findMany({
      where: {
        OR: [{ shopId: shop.id }, { product: { productShops: { some: { shopId: shop.id } } } }],
      },
      orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
      take: 6,
    }),
    prisma.product.findMany({
      where: { id: { in: productIds }, firstSeenAt: { gte: newProductCutoff } },
      include: {
        productShops: {
          where: { isActive: true },
          orderBy: { lastSeenAt: 'desc' },
          take: 1,
          select: { shop: { select: { id: true, name: true, avatarUrl: true } } },
        },
      },
      orderBy: { firstSeenAt: 'desc' },
      take: 12,
    }),
  ]);

  return {
    ...card,
    firstSeenAt: shop.firstSeenAt.toISOString(),
    salesTimeline: buildShopTimeline(shop, range, 'sales'),
    gmvTimeline: buildShopTimeline(shop, range, 'gmv'),
    newProducts: newProductRows.map((product) =>
      toProductCard(product, undefined, emptyGrowth(now, range), shop.name),
    ),
    topAffiliates: affiliates,
    topTrendVideos: videos.map(toTrendVideo),
  };
}

/**
 * Biểu đồ doanh thu của shop theo từng mốc `bucketDate` của snapshot lịch sử.
 *
 * - `sales`: ΔsoldCount giữa 2 mốc bucketDate liên tiếp (số bán phát sinh).
 * - `gmv`  : price × soldCount của snapshot tại mỗi mốc bucketDate — đúng đặc tả
 *            "doanh thu GMV theo ngày = price * soldCount" và luôn là số liệu thật.
 */
function buildShopTimeline(
  shop: ShopWithCommerce,
  range: RangeMeta,
  metric: 'sales' | 'gmv',
): Array<{ date: string; value: number }> {
  const window = buildAnalyticsWindow(range.days, new Date(), range.anchor);
  const allowed = new Set(window.daysList.map((day) => day.toISOString().slice(0, 10)));
  const daily = new Map<string, number>();

  for (const tracking of shop.productShops) {
    let previousSold: number | null = null;
    for (const snapshot of tracking.snapshots) {
      const key = snapshot.bucketDate.toISOString().slice(0, 10);
      const sold = bigIntToNumber(snapshot.soldCountTotal) ?? 0;
      const price = decimalToNumber(snapshot.price) ?? 0;

      if (allowed.has(key)) {
        if (metric === 'gmv') {
          daily.set(key, (daily.get(key) ?? 0) + price * sold);
        } else {
          const soldDelta = previousSold === null ? sold : Math.max(0, sold - previousSold);
          daily.set(key, (daily.get(key) ?? 0) + soldDelta);
        }
      }
      previousSold = sold;
    }
  }

  return window.daysList.map((day) => {
    const key = day.toISOString().slice(0, 10);
    return { date: key, value: roundTo(daily.get(key) ?? 0, 0) };
  });
}

/* ------------------------------------------------------------------ */
/* Affiliates của shop                                                */
/* ------------------------------------------------------------------ */

export async function loadShopAffiliates(
  shopId: number,
  now: Date,
  range: RangeMeta,
  limit = 10,
): Promise<ShopCommerceCreatorCard[]> {
  const links = await prisma.creatorShop.findMany({
    where: { shopId, isActive: true },
    orderBy: [{ gmvTotal: 'desc' }, { soldCount: 'desc' }],
    take: Math.max(1, limit),
    include: { creator: true },
  });

  if (links.length === 0) return [];

  const creatorIds = links.map((link) => link.creatorId);

  const [snapshots, productLinks] = await Promise.all([
    prisma.creatorSnapshot.findMany({
      where: { creatorId: { in: creatorIds } },
      orderBy: { bucketDate: 'asc' },
      select: { creatorId: true, bucketDate: true, gmvTotal: true, followerCount: true, soldCount: true },
    }),
    prisma.productCreator.findMany({
      where: { creatorId: { in: creatorIds }, isActive: true },
      orderBy: { gmvTotal: 'desc' },
      include: { product: { select: { id: true, title: true, imageUrl: true, minPrice: true } } },
    }),
  ]);

  const snapshotsByCreator = new Map<number, typeof snapshots>();
  for (const snapshot of snapshots) {
    let bucket = snapshotsByCreator.get(snapshot.creatorId);
    if (!bucket) {
      bucket = [];
      snapshotsByCreator.set(snapshot.creatorId, bucket);
    }
    bucket.push(snapshot);
  }

  return links.map((link) => {
    const creatorSnapshots = snapshotsByCreator.get(link.creatorId) ?? [];
    const growth = creatorGrowth(creatorSnapshots, now, range);

    const products = productLinks
      .filter((productLink) => productLink.creatorId === link.creatorId)
      .slice(0, 3)
      .map((productLink) => ({
        id: productLink.product.id,
        title: productLink.product.title,
        imageUrl: productLink.product.imageUrl,
        price: decimalToNumber(productLink.product.minPrice),
        sales: bigIntToNumber(productLink.soldCount),
        gmv: decimalToNumber(productLink.gmvTotal),
      }));

    return {
      id: link.creator.id,
      platformCreatorId: link.creator.platformCreatorId,
      username: link.creator.username,
      displayName: link.creator.displayName,
      avatarUrl: link.creator.avatarUrl,
      role: link.creator.role,
      followerCount: bigIntToNumber(link.creator.followerCount),
      engagementRate: decimalToNumber(link.creator.engagementRate),
      gmv: link.gmvTotal || link.creator.gmvTotal ? roundTo(decimalToNumber(link.gmvTotal) ?? decimalToNumber(link.creator.gmvTotal) ?? 0, 0) : null,
      soldCount: bigIntToNumber(link.soldCount) ?? bigIntToNumber(link.creator.soldCount),
      videoCount: link.videoCount ?? link.creator.videoCount,
      growthRate: growth.primary.gmv.growthRate,
      growth,
      topProducts: products,
    };
  });
}

export function creatorGrowth(
  snapshots: Array<{ bucketDate: Date; gmvTotal: Prisma.Decimal | null; followerCount: bigint | null; soldCount: bigint | null }>,
  now: Date,
  range: number | RangeMeta,
): MultiPeriodMetrics {
  const days = typeof range === 'number' ? range : range.days;
  const anchor = typeof range === 'number' ? 'today' : range.anchor;
  const windows = periodWindows(now, anchor);
  const series = snapshots.map((snapshot) => ({
    bucketDate: snapshot.bucketDate,
    capturedAt: snapshot.bucketDate,
    sold: bigIntToNumber(snapshot.soldCount) ?? 0,
    gmv: decimalToNumber(snapshot.gmvTotal) ?? 0,
    price: 0,
    playCount: 0,
    diggCount: 0,
    shareCount: 0,
    commentCount: 0,
    stockTotal: null,
    ratingScore: null,
    ratingCount: null,
  }));

  const accumulators = new Map<number, ReturnType<typeof createAccumulator>>();
  for (const window of windows) {
    const acc = createAccumulator();
    accumulate(acc, series, window);
    accumulators.set(window.days, acc);
  }

  return buildMultiPeriodAggregate(accumulators, windows, days);
}
