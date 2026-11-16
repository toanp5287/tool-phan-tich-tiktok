import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type { ProductListItem, ShopDetail, ShopListItem } from '../types/api.js';
import { AppError } from '../utils/errors.js';
import { buildAnalyticsWindow, isoDateKey } from '../utils/dates.js';
import { bigIntToNumber, clampInt, decimalToNumber, percentChange, roundTo, safeDivide } from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';
import { buildKeywordCloud } from '../utils/analyticsMath.js';
import { getShopAffiliates } from './creatorService.js';
import { buildAggregateGrowth, buildGrowthFromSnapshot, serializeGrowth } from './growthService.js';

export interface ShopListFilters {
  search?: string;
  region?: string;
  sortBy?: 'gmv' | 'sales' | 'products' | 'recent';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  days?: number;
  anchor?: 'today' | 'yesterday';
  source?: string;
}

const SHOP_SORT_ACCESSORS: Record<NonNullable<ShopListFilters['sortBy']>, (item: ShopListItem) => number> = {
  gmv: (item) => item.totalGmv,
  sales: (item) => item.totalSales,
  products: (item) => item.productCount,
  recent: (item) => (item.lastSeenAt ? Date.parse(item.lastSeenAt) : 0),
};

export async function listShops(filters: ShopListFilters): Promise<{ items: ShopListItem[]; total: number }> {
  const days = clampInt(filters.days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(days, new Date(), filters.anchor ?? 'today');
  const where: Prisma.ShopWhereInput = {};

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { username: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  if (filters.region) where.region = filters.region;
  if (filters.source) where.source = filters.source;

  const total = await prisma.shop.count({ where });

  const shops = await prisma.shop.findMany({
    where,
    include: {
      revenueSnapshots: {
        where: { bucketDate: { gte: window.currentStart, lte: window.currentEnd } },
        orderBy: [{ bucketDate: 'desc' }, { capturedAt: 'desc' }],
      },
      productShops: {
        where: { isActive: true },
        include: {
          product: { select: { id: true, title: true, imageUrl: true } },
          snapshots: {
            where: { bucketDate: { gte: window.previousStart, lte: window.currentEnd } },
            orderBy: { bucketDate: 'desc' },
            take: 2 * 45,
          },
        },
      },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
  });

  const items: ShopListItem[] = shops.map((shop) => toShopListItem(shop, window));
  const direction = filters.sortDir === 'asc' ? 1 : -1;

  if (filters.sortBy) {
    const extractor = SHOP_SORT_ACCESSORS[filters.sortBy];
    items.sort((a, b) => {
      if (filters.sortBy === 'gmv' && a.hasGmv !== b.hasGmv) return a.hasGmv ? -1 : 1;
      if (filters.sortBy === 'sales' && a.hasSales !== b.hasSales) return a.hasSales ? -1 : 1;
      return (extractor(a) - extractor(b)) * direction || a.id - b.id;
    });
  }

  const start = (filters.page - 1) * filters.pageSize;
  return { items: items.slice(start, start + filters.pageSize), total };
}

interface ShopSnapshotRow {
  price: Prisma.Decimal | null;
  soldCountTotal: bigint | null;
  soldCount1d: bigint | null;
  soldCount7d: bigint | null;
  soldCount30d: bigint | null;
  soldCount90d: bigint | null;
  gmvTotal: Prisma.Decimal | null;
  gmv1d: Prisma.Decimal | null;
  gmv7d: Prisma.Decimal | null;
  gmv30d: Prisma.Decimal | null;
  gmv90d: Prisma.Decimal | null;
  playCount: bigint | null;
  diggCount: bigint | null;
  shareCount: bigint | null;
  stockTotal?: number | null;
  ratingScore?: Prisma.Decimal | null;
  ratingCount?: bigint | null;
  sellerCount?: number | null;
  capturedAt: Date;
  bucketDate: Date;
}

/** Cộng dồn delta mới nhất của từng sản phẩm để có xu hướng 1/7/30/90 ngày của shop. */
function aggregateShopGrowth(
  trackings: Array<{ snapshots: ShopSnapshotRow[] }>,
  window: ReturnType<typeof buildAnalyticsWindow>,
) {
  const totals = {
    soldCountTotal: 0,
    gmvTotal: 0,
    soldCount1d: 0,
    soldCount7d: 0,
    soldCount30d: 0,
    soldCount90d: 0,
    gmv1d: 0,
    gmv7d: 0,
    gmv30d: 0,
    gmv90d: 0,
    soldHasData: false,
    gmvHasData: false,
  };

  for (const tracking of trackings) {
    const current = tracking.snapshots.filter((snapshot) => snapshot.bucketDate >= window.currentStart);
    const latest = latestSnapshot(current) ?? latestSnapshot(tracking.snapshots);
    if (!latest) continue;

    totals.soldCountTotal += bigIntToNumber(latest.soldCountTotal) ?? 0;
    totals.gmvTotal += decimalToNumber(latest.gmvTotal) ?? 0;
    totals.soldCount1d += bigIntToNumber(latest.soldCount1d) ?? 0;
    totals.soldCount7d += bigIntToNumber(latest.soldCount7d) ?? 0;
    totals.soldCount30d += bigIntToNumber(latest.soldCount30d) ?? 0;
    totals.soldCount90d += bigIntToNumber(latest.soldCount90d) ?? 0;
    totals.gmv1d += decimalToNumber(latest.gmv1d) ?? 0;
    totals.gmv7d += decimalToNumber(latest.gmv7d) ?? 0;
    totals.gmv30d += decimalToNumber(latest.gmv30d) ?? 0;
    totals.gmv90d += decimalToNumber(latest.gmv90d) ?? 0;
    totals.soldHasData = totals.soldHasData || latest.soldCount1d !== null;
    totals.gmvHasData = totals.gmvHasData || latest.gmv1d !== null;
  }

  return serializeGrowth(buildAggregateGrowth(totals), window.days);
}

function splitSnapshotsByWindow(
  snapshots: ShopSnapshotRow[],
  window: ReturnType<typeof buildAnalyticsWindow>,
): { current: ShopSnapshotRow[]; previous: ShopSnapshotRow[] } {
  const current: ShopSnapshotRow[] = [];
  const previous: ShopSnapshotRow[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.bucketDate >= window.currentStart) current.push(snapshot);
    else if (snapshot.bucketDate >= window.previousStart) previous.push(snapshot);
  }

  return { current, previous };
}

function latestSnapshot(rows: ShopSnapshotRow[]): ShopSnapshotRow | undefined {
  let latest: ShopSnapshotRow | undefined;
  for (const row of rows) {
    if (!latest || row.bucketDate > latest.bucketDate) latest = row;
  }
  return latest;
}

function toShopListItem(
  shop: {
    id: number;
    platformShopId: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    followerCount: bigint | null;
    ratingScore: Prisma.Decimal | null;
    lastSeenAt: Date;
    source: string;
    productCount: number;
    revenueSnapshots: Array<{ source: string; gmvTotal: Prisma.Decimal | null; soldCountTotal: bigint | null; productCount: number | null; capturedAt: Date }>;
    productShops: Array<{
      product: { id: number; title: string; imageUrl: string | null };
      snapshots: ShopSnapshotRow[];
    }>;
  },
  window: ReturnType<typeof buildAnalyticsWindow>,
): ShopListItem {
  let totalSales = 0;
  let totalGmv = 0;
  let totalViews = 0;
  let priceSum = 0;
  let priceCount = 0;
  let previousSales = 0;
  let hasGmv = false;
  let hasSales = false;
  const productSales: Array<{ id: number; title: string; imageUrl: string | null; sales: number; gmv: number }> = [];

  for (const tracking of shop.productShops) {
    const { current, previous } = splitSnapshotsByWindow(tracking.snapshots, window);
    const latest = latestSnapshot(current);
    hasGmv ||= latest?.gmvTotal != null;
    hasSales ||= latest?.soldCountTotal != null;
    const previousSnapshot = latestSnapshot(previous);

    const sales = bigIntToNumber(latest?.soldCountTotal) ?? 0;
    const gmv = decimalToNumber(latest?.gmvTotal) ?? 0;

    totalSales += sales;
    totalGmv += gmv;
    totalViews += bigIntToNumber(latest?.playCount) ?? 0;
    previousSales += bigIntToNumber(previousSnapshot?.soldCountTotal) ?? sales;

    productSales.push({
      id: tracking.product.id,
      title: tracking.product.title,
      imageUrl: tracking.product.imageUrl,
      sales,
      gmv: roundTo(gmv, 0),
    });

    const price = decimalToNumber(latest?.price);
    if (price !== null && price > 0) {
      priceSum += price;
      priceCount += 1;
    }
  }

  const ownSnapshot = shop.revenueSnapshots.find((snapshot) => snapshot.source === shop.source);
  if (ownSnapshot?.gmvTotal != null) {
    totalGmv = decimalToNumber(ownSnapshot.gmvTotal) ?? 0;
    hasGmv = true;
  }
  if (ownSnapshot?.soldCountTotal != null) {
    totalSales = bigIntToNumber(ownSnapshot.soldCountTotal) ?? 0;
    hasSales = true;
  }
  return {
    id: shop.id,
    platformShopId: shop.platformShopId,
    name: shop.name,
    username: shop.username,
    avatarUrl: shop.avatarUrl,
    productCount: ownSnapshot?.productCount ?? shop.productCount,
    linkedProductCount: shop.productShops.length,
    source: shop.source,
    hasGmv,
    hasSales,
    metricsSource: ownSnapshot?.gmvTotal != null ? 'shop-snapshot' : hasGmv ? 'product-snapshots' : null,
    totalSales,
    totalGmv: roundTo(totalGmv, 0),
    totalViews,
    avgPrice: priceCount > 0 ? roundTo(safeDivide(priceSum, priceCount), 0) : 0,
    avgOrderValue: totalSales > 0 ? roundTo(safeDivide(totalGmv, totalSales), 0) : 0,
    followerCount: bigIntToNumber(shop.followerCount) ?? 0,
    ratingScore: decimalToNumber(shop.ratingScore),
    growthRate: percentChange(totalSales, previousSales),
    growth: aggregateShopGrowth(shop.productShops, window),
    lastSeenAt: toIso(shop.lastSeenAt),
    topProducts: productSales.sort((a, b) => b.sales - a.sales).slice(0, 3),
  };
}

export async function getShopDetail(
  shopId: number,
  windowDays: number,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<ShopDetail> {
  const days = clampInt(windowDays, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(days, new Date(), anchor);
  const newProductCutoff = new Date(Date.now() - 14 * 86_400_000);

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      productShops: {
        include: {
          product: { include: { variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }], take: 1 } } },
          snapshots: {
            where: { bucketDate: { gte: window.previousStart, lte: window.currentEnd } },
            orderBy: { bucketDate: 'asc' },
          },
        },
      },
      revenueSnapshots: {
        where: { bucketDate: { gte: window.currentStart, lte: window.currentEnd } },
        orderBy: { bucketDate: 'asc' },
      },
    },
  });

  if (!shop) throw AppError.notFound(`Không tìm thấy shop #${shopId}`);

  // Snapshot lưu số luỹ kế -> timeline phát sinh theo ngày (delta) dựa trên bucketDate.
  // GMV theo ngày = price × ΔsoldCount (doanh thu thực tế từ snapshot).
  const dailySales = new Map<string, number>();
  const dailyGmv = new Map<string, number>();
  const seriesByProductShop = new Map<number, Map<string, { sold: number; price: number }>>();

  for (const tracking of shop.productShops) {
    const series = new Map<string, { sold: number; price: number }>();
    for (const snapshot of tracking.snapshots) {
      const key = isoDateKey(snapshot.bucketDate);
      series.set(key, {
        sold: bigIntToNumber(snapshot.soldCountTotal) ?? 0,
        price: decimalToNumber(snapshot.price) ?? 0,
      });
    }
    seriesByProductShop.set(tracking.id, series);
  }

  for (const series of seriesByProductShop.values()) {
    let previousSold: number | null = null;
    for (const day of window.daysList) {
      const key = isoDateKey(day);
      const value = series.get(key);
      if (value === undefined) continue;

      const soldDelta = previousSold === null ? value.sold : Math.max(0, value.sold - previousSold);
      dailySales.set(key, (dailySales.get(key) ?? 0) + soldDelta);
      // Doanh thu GMV theo ngày = price × soldCount của snapshot tại bucketDate.
      dailyGmv.set(key, (dailyGmv.get(key) ?? 0) + value.price * value.sold);
      previousSold = value.sold;
    }
  }

  const salesTimeline = window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(dailySales.get(key) ?? 0, 0) };
  });

  const gmvTimeline = window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(dailyGmv.get(key) ?? 0, 0) };
  });

  let totalSales = 0;
  let totalGmv = 0;
  let totalViews = 0;
  let priceSum = 0;
  let priceCount = 0;
  let previousSales = 0;

  const products: ProductListItem[] = shop.productShops.map((tracking) => {
    const { current, previous } = splitSnapshotsByWindow(tracking.snapshots, window);
    const latest = latestSnapshot(current);
    const previousSnapshot = latestSnapshot(previous);

    const sales = bigIntToNumber(latest?.soldCountTotal) ?? 0;
    const gmv = decimalToNumber(latest?.gmvTotal) ?? 0;
    const views = bigIntToNumber(latest?.playCount) ?? 0;
    const price = decimalToNumber(latest?.price) ?? 0;
    const previousValue = bigIntToNumber(previousSnapshot?.soldCountTotal) ?? sales;
    const growth = serializeGrowth(buildGrowthFromSnapshot(latest ?? null), days);

    totalSales += sales;
    totalGmv += gmv;
    totalViews += views;
    previousSales += previousValue;

    if (price > 0) {
      priceSum += price;
      priceCount += 1;
    }

    return {
      id: tracking.product.id,
      platformProductId: tracking.product.platformProductId,
      title: tracking.product.title,
      imageUrl: tracking.product.imageUrl,
      productUrl: tracking.product.productUrl,
      category: tracking.product.category,
      subCategory: tracking.product.subCategory,
      shopId: shop.id,
      shopName: shop.name,
      shopAvatarUrl: shop.avatarUrl,
      price,
      minPrice: decimalToNumber(tracking.product.minPrice),
      maxPrice: decimalToNumber(tracking.product.maxPrice),
      minOriginalPrice: decimalToNumber(tracking.product.minOriginalPrice),
      maxOriginalPrice: decimalToNumber(tracking.product.maxOriginalPrice),
      stockTotal: latest?.stockTotal ?? tracking.product.stockTotal,
      ratingScore: decimalToNumber(latest?.ratingScore ?? tracking.product.ratingScore),
      ratingCount: bigIntToNumber(latest?.ratingCount ?? tracking.product.ratingCount) ?? 0,
      isAvailable: tracking.product.isAvailable,
      variantCount: tracking.product.variantCount,
      sellerCount: latest?.sellerCount ?? tracking.product.sellerCount,
      sales,
      gmv,
      views,
      likes: bigIntToNumber(latest?.diggCount) ?? 0,
      shares: bigIntToNumber(latest?.shareCount) ?? 0,
      growthRate: growth.primary.salesGrowthRate || percentChange(sales, previousValue),
      growth,
      lastSeenAt: toIso(tracking.product.lastSeenAt),
      capturedAt: toIso(latest?.capturedAt ?? null),
    };
  });

  const sortedByGmv = [...products].sort((a, b) => b.gmv - a.gmv);

  const topProducts = sortedByGmv
    .slice(0, 10)
    .map((item) => ({ id: item.id, title: item.title, sales: item.sales, gmv: item.gmv, price: item.price }));

  // Sản phẩm mới = lần đầu được ghi nhận trong 2 tuần gần nhất.
  const newProducts = shop.productShops
    .filter((tracking) => tracking.product.firstSeenAt.getTime() >= newProductCutoff.getTime())
    .sort((a, b) => b.product.firstSeenAt.getTime() - a.product.firstSeenAt.getTime())
    .slice(0, 12)
    .map((tracking) => products.find((product) => product.id === tracking.product.id))
    .filter((product): product is ProductListItem => Boolean(product));

  const revenueSources = buildRevenueSources(shop.revenueSnapshots, window);
  const topAffiliates = await getShopAffiliates(shop.id, 10, days, anchor);

  return {
    shop: {
      id: shop.id,
      platformShopId: shop.platformShopId,
      name: shop.name,
      username: shop.username,
      avatarUrl: shop.avatarUrl,
      shopUrl: shop.shopUrl,
      followerCount: bigIntToNumber(shop.followerCount) ?? 0,
      productCount: products.length,
      totalSales,
      totalGmv: roundTo(totalGmv, 0),
      totalViews,
      avgPrice: priceCount > 0 ? roundTo(safeDivide(priceSum, priceCount), 0) : 0,
      avgOrderValue: totalSales > 0 ? roundTo(safeDivide(totalGmv, totalSales), 0) : 0,
      ratingScore: decimalToNumber(shop.ratingScore),
      ratingCount: bigIntToNumber(shop.ratingCount) ?? 0,
      soldCountTotal: bigIntToNumber(shop.soldCountTotal) ?? totalSales,
      growthRate: percentChange(totalSales, previousSales),
      growth: aggregateShopGrowth(shop.productShops, window),
      lastSeenAt: toIso(shop.lastSeenAt),
      firstSeenAt: toIso(shop.firstSeenAt),
    },
    products: sortedByGmv,
    salesTimeline,
    gmvTimeline,
    topProducts,
    revenueSources,
    topAffiliates,
    newProducts,
  };
}

/**
 * Tổng hợp doanh thu bóc tách theo nguồn tiền (Video / Live / Giỏ hàng / Product card).
 * Nếu bảng ShopRevenueSnapshot chưa có dữ liệu, ước lượng phân bổ dựa trên GMV sản phẩm
 * để biểu đồ vẫn hiển thị và được đánh dấu `isEstimated`.
 */
function buildRevenueSources(
  snapshots: Array<{
    capturedAt: Date;
    bucketDate: Date;
    gmvVideo: Prisma.Decimal | null;
    gmvLive: Prisma.Decimal | null;
    gmvCart: Prisma.Decimal | null;
    gmvProductCard: Prisma.Decimal | null;
    gmvTotal: Prisma.Decimal | null;
    isEstimated: boolean;
  }>,
  window: ReturnType<typeof buildAnalyticsWindow>,
): ShopDetail['revenueSources'] {
  const byDay = new Map<
    string,
    { video: number; live: number; cart: number; productCard: number; total: number }
  >();

  let isEstimated = snapshots.length === 0;

  for (const snapshot of snapshots) {
    const key = isoDateKey(snapshot.bucketDate);
    const video = decimalToNumber(snapshot.gmvVideo) ?? 0;
    const live = decimalToNumber(snapshot.gmvLive) ?? 0;
    const cart = decimalToNumber(snapshot.gmvCart) ?? 0;
    const productCard = decimalToNumber(snapshot.gmvProductCard) ?? 0;
    const total = decimalToNumber(snapshot.gmvTotal) ?? video + live + cart + productCard;

    byDay.set(key, { video, live, cart, productCard, total });
    if (snapshot.isEstimated) isEstimated = true;
  }

  const series = window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, ...(byDay.get(key) ?? { video: 0, live: 0, cart: 0, productCard: 0, total: 0 }) };
  });

  let video = 0;
  let live = 0;
  let cart = 0;
  let productCard = 0;
  let total = 0;

  for (const point of series) {
    video += point.video;
    live += point.live;
    cart += point.cart;
    productCard += point.productCard;
    total += point.total;
  }

  const effectiveTotal = total > 0 ? total : video + live + cart + productCard;
  const share = (part: number) => (effectiveTotal > 0 ? roundTo((part / effectiveTotal) * 100, 2) : 0);

  return {
    series: series.map((point) => ({
      ...point,
      video: roundTo(point.video, 0),
      live: roundTo(point.live, 0),
      cart: roundTo(point.cart, 0),
      productCard: roundTo(point.productCard, 0),
      total: roundTo(point.total, 0),
    })),
    summary: {
      video: roundTo(video, 0),
      live: roundTo(live, 0),
      cart: roundTo(cart, 0),
      productCard: roundTo(productCard, 0),
      total: roundTo(effectiveTotal, 0),
      videoShare: share(video),
      liveShare: share(live),
      cartShare: share(cart),
      productCardShare: share(productCard),
      isEstimated,
    },
  };
}

export async function getKeywordInsights(windowDays = 7, limit = 15) {
  const days = clampInt(windowDays, 1, SNAPSHOT_WINDOW_DAYS.max, 7);
  const window = buildAnalyticsWindow(days);

  const trends = await prisma.trendItem.findMany({
    where: { scrapedAt: { gte: window.currentStart, lte: window.currentEnd } },
    select: { keywords: true, content: true, playCount: true },
    take: 2000,
  });

  return buildKeywordCloud(trends, limit);
}

export async function listTrendItems(page: number, pageSize: number) {
  const [total, items] = await Promise.all([
    prisma.trendItem.count(),
    prisma.trendItem.findMany({
      orderBy: { scrapedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    total,
    items: items.map((item) => ({
      id: item.id,
      author: item.author,
      content: item.content,
      keywords: item.keywords ?? [],
      videoUrl: item.videoUrl,
      playCount: bigIntToNumber(item.playCount),
      diggCount: bigIntToNumber(item.diggCount),
      shareCount: bigIntToNumber(item.shareCount),
      commentCount: bigIntToNumber(item.commentCount),
      scrapedAt: toIso(item.scrapedAt),
    })),
  };
}
