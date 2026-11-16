import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { SNAPSHOT_WINDOW_DAYS } from '../config/constants.js';
import type { DashboardOverview, DashboardTrendItem, TrendSummary } from '../types/api.js';
import { buildAnalyticsWindow, isoDateKey, startOfUtcDay } from '../utils/dates.js';
import {
  bigIntToNumber,
  clampInt,
  decimalToNumber,
  percentChange,
  roundTo,
  safeDivide,
} from '../utils/numbers.js';
import { toIso } from '../utils/serializers.js';
import { getTopCreators } from './creatorService.js';
import { buildAggregateGrowth, serializeGrowth } from './growthService.js';
import { listShops } from './shopService.js';
import { listCategoryCatalog } from './categoryCatalogService.js';

const MAX_TOP_PRODUCTS = 100;

/** bucketDate là cột DATE (00:00 UTC) nên luôn so sánh theo mốc đầu ngày. */
function toBucketDateEnd(value: Date): Date {
  return startOfUtcDay(value);
}

export async function getTrendSummary(
  days: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<TrendSummary> {
  const safeDays = clampInt(days, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(safeDays, new Date(), anchor);

  const [currentRows, previousRows] = await Promise.all([
    prisma.productSnapshot.findMany({
      where: { bucketDate: { gte: window.currentStart, lte: toBucketDateEnd(window.currentEnd) } },
      select: { productId: true, soldCountTotal: true },
    }),
    prisma.productSnapshot.findMany({
      where: { bucketDate: { gte: window.previousStart, lte: toBucketDateEnd(window.previousEnd) } },
      select: { productId: true, soldCountTotal: true },
    }),
  ]);

  const currentSales = sumLatestPerProduct(currentRows);
  const previousSales = sumLatestPerProduct(previousRows);

  // Like-for-like: chá»‰ so sÃ¡nh cÃ¡c sáº£n pháº©m cÃ³ máº·t á»Ÿ cáº£ 2 ká»³.
  let comparableCurrent = 0;
  let comparablePrevious = 0;
  for (const [productId, current] of currentSales.entries()) {
    const previous = previousSales.get(productId);
    if (previous === undefined) continue;
    comparableCurrent += current;
    comparablePrevious += previous;
  }

  const growthRate =
    comparablePrevious > 0 ? percentChange(comparableCurrent, comparablePrevious) : percentChange(sumValues(currentSales), sumValues(previousSales));
  const trend: TrendSummary['trend'] = growthRate > 0.5 ? 'up' : growthRate < -0.5 ? 'down' : 'flat';

  return {
    totalCurrent: Math.round(comparableCurrent || sumValues(currentSales)),
    totalPrevious: Math.round(comparablePrevious || sumValues(previousSales)),
    growthRate,
    trend,
    label: trend === 'up' ? 'TÄ‚NG TRÆ¯á»žNG' : trend === 'down' ? 'SUY GIáº¢M' : 'á»”N Äá»ŠNH',
  };
}

function sumLatestPerProduct(rows: Array<{ productId: number; soldCountTotal: bigint | null }>): Map<number, number> {
  // Snapshot Ä‘Ã£ unique theo (productId, source, bucketDate) nÃªn cá»™ng dá»“n theo product lÃ  an toÃ n,
  // nhÆ°ng náº¿u cÃ³ nhiá»u source thÃ¬ láº¥y giÃ¡ trá»‹ lá»›n nháº¥t Ä‘á»ƒ trÃ¡nh double-count.
  const result = new Map<number, number>();
  for (const row of rows) {
    const value = bigIntToNumber(row.soldCountTotal) ?? 0;
    const existing = result.get(row.productId);
    if (existing === undefined || value > existing) result.set(row.productId, value);
  }
  return result;
}

function sumValues(map: Map<number, number>): number {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}

export async function getDashboardOverview(
  windowDays: number = SNAPSHOT_WINDOW_DAYS.default,
  anchor: 'today' | 'yesterday' = 'today',
): Promise<DashboardOverview> {
  const days = clampInt(windowDays, 1, SNAPSHOT_WINDOW_DAYS.max, SNAPSHOT_WINDOW_DAYS.default);
  const window = buildAnalyticsWindow(days, new Date(), anchor);

  const [productCount, shopCount, snapshotCount, trackingCount, creatorCount, trend, lastJob] = await Promise.all([
    prisma.product.count(),
    prisma.shop.count(),
    prisma.productSnapshot.count(),
    prisma.productShop.count({ where: { isActive: true } }),
    prisma.creator.count(),
    getTrendSummary(days, anchor),
    prisma.scrapeJob.findFirst({ orderBy: { createdAt: 'desc' } }),
  ]);

  const snapshots = await prisma.productSnapshot.findMany({
    where: { bucketDate: { gte: window.currentStart, lte: toBucketDateEnd(window.currentEnd) } },
    select: {
      productId: true,
      soldCountTotal: true,
      soldCount1d: true,
      soldCount7d: true,
      soldCount30d: true,
      soldCount90d: true,
      gmvTotal: true,
      gmv1d: true,
      gmv7d: true,
      gmv30d: true,
      gmv90d: true,
      playCount: true,
      price: true,
      sellerCount: true,
      capturedAt: true,
      bucketDate: true,
      product: {
        select: {
          id: true,
          title: true,
          imageUrl: true,
          category: true,
          sellerCount: true,
          minPrice: true,
          productShops: {
            where: { isActive: true },
            orderBy: { lastSeenAt: 'desc' },
            take: 1,
            select: { shop: { select: { id: true, name: true } } },
          },
        },
      },
    },
    orderBy: { bucketDate: 'asc' },
  });

  const previousSnapshots = await prisma.productSnapshot.findMany({
    where: { bucketDate: { gte: window.previousStart, lte: toBucketDateEnd(window.previousEnd) } },
    select: { productId: true, soldCountTotal: true, gmvTotal: true },
    orderBy: { bucketDate: 'asc' },
  });

  const previousSalesByProduct = new Map<number, number>();
  const baselineByProduct = new Map<number, { sales: number; gmv: number }>();
  for (const snapshot of previousSnapshots) {
    const sales = bigIntToNumber(snapshot.soldCountTotal) ?? 0;
    const gmv = decimalToNumber(snapshot.gmvTotal) ?? 0;
    // Lấy snapshot mới nhất trong kỳ trước (mảng đã sắp xếp tăng dần theo capturedAt).
    previousSalesByProduct.set(snapshot.productId, sales);
    baselineByProduct.set(snapshot.productId, { sales, gmv });
  }

  // Snapshot lưu số luỹ kế, nên phải lấy bản ghi MỚI NHẤT của mỗi sản phẩm
  // (không cộng dồn nhiều ngày) và tính doanh thu phát sinh trong ngày bằng delta.
  const latestByProduct = new Map<number, (typeof snapshots)[number]>();
  const dailySeriesByProduct = new Map<number, Map<string, { sales: number; gmv: number }>>();

  for (const snapshot of snapshots) {
    const current = latestByProduct.get(snapshot.productId);
    if (!current || snapshot.bucketDate >= current.bucketDate) latestByProduct.set(snapshot.productId, snapshot);

    const sales = bigIntToNumber(snapshot.soldCountTotal) ?? 0;
    const gmv = decimalToNumber(snapshot.gmvTotal) ?? 0;
    const dayKey = isoDateKey(snapshot.bucketDate);

    let series = dailySeriesByProduct.get(snapshot.productId);
    if (!series) {
      series = new Map();
      dailySeriesByProduct.set(snapshot.productId, series);
    }
    series.set(dayKey, { sales, gmv });
  }

  const revenueByDay = new Map<string, number>();
  const salesByDay = new Map<string, number>();

  // Chuyển chuỗi luỹ kế thành phát sinh theo ngày cho từng sản phẩm.
  for (const [productId, series] of dailySeriesByProduct.entries()) {
    const baseline = baselineByProduct.get(productId) ?? null;
    let previous: { sales: number; gmv: number } = baseline ?? { sales: 0, gmv: 0 };
    let hasBaseline = baseline !== null;

    for (const day of window.daysList) {
      const key = isoDateKey(day);
      const point = series.get(key);
      if (!point) continue;

      // Chưa có baseline (lần cào đầu tiên) thì dùng chính giá trị luỹ kế của mốc
      // đầu tiên làm doanh thu phát sinh — vẫn là số liệu thật từ snapshot.
      const deltaSales = hasBaseline ? Math.max(0, point.sales - previous.sales) : point.sales;
      const deltaGmv = hasBaseline ? Math.max(0, point.gmv - previous.gmv) : point.gmv;

      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + deltaGmv);
      salesByDay.set(key, (salesByDay.get(key) ?? 0) + deltaSales);
      previous = point;
      hasBaseline = true;
    }
  }

  let totalSales = 0;
  let totalGmv = 0;
  let totalViews = 0;

  const productAggregate = new Map<
    number,
    {
      id: number;
      title: string;
      imageUrl: string | null;
      shopName: string;
      shopId: number | null;
      category: string | null;
      gmv: number;
      sales: number;
      sellerCount: number;
      price: number;
      previousSales: number;
      capturedAt: Date;
    }
  >();

  for (const snapshot of latestByProduct.values()) {
    const sales = bigIntToNumber(snapshot.soldCountTotal) ?? 0;
    const gmv = decimalToNumber(snapshot.gmvTotal) ?? 0;
    const views = bigIntToNumber(snapshot.playCount) ?? 0;

    totalSales += sales;
    totalGmv += gmv;
    totalViews += views;

    const shop = snapshot.product.productShops[0]?.shop ?? null;

    productAggregate.set(snapshot.product.id, {
      id: snapshot.product.id,
      title: snapshot.product.title,
      imageUrl: snapshot.product.imageUrl,
      shopName: shop?.name ?? 'TikTok Shop',
      shopId: shop?.id ?? null,
      category: snapshot.product.category,
      gmv,
      sales,
      sellerCount: snapshot.sellerCount ?? snapshot.product.sellerCount,
      price: decimalToNumber(snapshot.price) ?? decimalToNumber(snapshot.product.minPrice) ?? 0,
      previousSales: previousSalesByProduct.get(snapshot.productId) ?? sales,
      capturedAt: snapshot.capturedAt,
    });
  }

  const revenueTimeline = window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(revenueByDay.get(key) ?? 0, 0) };
  });

  const salesTimeline = window.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(salesByDay.get(key) ?? 0, 0) };
  });

  // Xu hướng 1/7/30/90 ngày: cộng delta mới nhất của từng sản phẩm.
  const growthTotals = {
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

  for (const snapshot of latestByProduct.values()) {
    growthTotals.soldCountTotal += bigIntToNumber(snapshot.soldCountTotal) ?? 0;
    growthTotals.gmvTotal += decimalToNumber(snapshot.gmvTotal) ?? 0;
    growthTotals.soldCount1d += bigIntToNumber(snapshot.soldCount1d) ?? 0;
    growthTotals.soldCount7d += bigIntToNumber(snapshot.soldCount7d) ?? 0;
    growthTotals.soldCount30d += bigIntToNumber(snapshot.soldCount30d) ?? 0;
    growthTotals.soldCount90d += bigIntToNumber(snapshot.soldCount90d) ?? 0;
    growthTotals.gmv1d += decimalToNumber(snapshot.gmv1d) ?? 0;
    growthTotals.gmv7d += decimalToNumber(snapshot.gmv7d) ?? 0;
    growthTotals.gmv30d += decimalToNumber(snapshot.gmv30d) ?? 0;
    growthTotals.gmv90d += decimalToNumber(snapshot.gmv90d) ?? 0;
    growthTotals.soldHasData = growthTotals.soldHasData || snapshot.soldCount1d !== null;
    growthTotals.gmvHasData = growthTotals.gmvHasData || snapshot.gmv1d !== null;
  }

  const growth = serializeGrowth(buildAggregateGrowth(growthTotals), days);

  // Trang chá»§: Top 100 sáº£n pháº©m cÃ³ nhiá»u ngÆ°á»i bÃ¡n nháº¥t (sellerCount)
  const topProducts = Array.from(productAggregate.values())
    .sort((a, b) => b.sellerCount - a.sellerCount || b.gmv - a.gmv)
    .slice(0, MAX_TOP_PRODUCTS)
    .map((value) => ({
      id: value.id,
      title: value.title,
      imageUrl: value.imageUrl,
      shopName: value.shopName,
      shopId: value.shopId,
      category: value.category,
      gmv: roundTo(value.gmv, 0),
      sales: value.sales,
      sellerCount: value.sellerCount,
      price: roundTo(value.price, 0),
      growthRate: percentChange(value.sales, value.previousSales),
    }));

  const rankedShops = await listShops({ page: 1, pageSize: 10, sortBy: 'gmv', sortDir: 'desc', days, anchor });
  const topShops = rankedShops.items.filter((shop) => shop.hasGmv).map((shop) => ({
    id: shop.id, name: shop.name, gmv: shop.totalGmv, sales: shop.totalSales, productCount: shop.productCount,
  }));

  const topCreators = (await getTopCreators(10, days)).map((creator) => ({
    id: creator.id,
    displayName: creator.displayName,
    username: creator.username,
    avatarUrl: creator.avatarUrl,
    gmv: creator.gmv,
    soldCount: creator.soldCount,
    followerCount: creator.followerCount,
    engagementRate: creator.engagementRate,
  }));

  const categoryAggregate = new Map<string, { products: number; gmv: number }>();
  for (const value of productAggregate.values()) {
    const key = value.category ?? 'KhÃ¡c';
    const current = categoryAggregate.get(key) ?? { products: 0, gmv: 0 };
    current.products += 1;
    current.gmv += value.gmv;
    categoryAggregate.set(key, current);
  }

  const categoryBreakdown = Array.from(categoryAggregate.entries())
    .map(([category, value]) => ({ category, products: value.products, gmv: roundTo(value.gmv, 0), hasData: true }))
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 8);
  if (categoryBreakdown.length === 0) {
    for (const category of await listCategoryCatalog()) {
      categoryBreakdown.push({ category: category.name, products: 0, gmv: 0, hasData: false });
    }
  }

  const topCategories = categoryBreakdown.map((entry) => ({
    name: entry.category,
    totalGmv: entry.gmv,
    shareOfGmv: totalGmv > 0 ? roundTo((entry.gmv / totalGmv) * 100, 2) : 0,
  }));

  const topTrendVideos = await buildDashboardTrendItems(productAggregate, topProducts);

  return {
    totals: {
      products: productCount,
      shops: shopCount,
      snapshots: snapshotCount,
      trackings: trackingCount,
      creators: creatorCount,
    },
    dataQuality: {
      hasProductMetrics: latestByProduct.size > 0,
      hasGmvRanking: topShops.length > 0,
      categoryCatalogOnly: categoryAggregate.size === 0,
    },
    range: {
      key: days === 1 ? (anchor === 'yesterday' ? 'yesterday' : 'today') : `${days}d`,
      label: days === 1 ? (anchor === 'yesterday' ? 'Hôm qua' : 'Hôm nay') : `${days} ngày qua`,
      days,
    },
    revenue: {
      totalGmv: roundTo(totalGmv, 0),
      totalSales,
      totalViews,
      avgOrderValue: roundTo(safeDivide(totalGmv, totalSales), 0),
    },
    trend,
    growth,
    lastJob: lastJob
      ? {
          id: lastJob.id,
          source: lastJob.source,
          status: lastJob.status,
          trigger: lastJob.trigger,
          startedAt: toIso(lastJob.startedAt),
          finishedAt: toIso(lastJob.finishedAt),
          durationMs: lastJob.durationMs,
          recordsFound: lastJob.recordsFound,
          recordsSaved: lastJob.recordsSaved,
          recordsFailed: lastJob.recordsFailed,
        }
      : null,
    topProducts,
    topShops,
    topCreators,
    categoryBreakdown,
    revenueTimeline,
    salesTimeline,
    topTrendVideos,
    topCategories,
  };
}

/**
 * Top Trend Video thực tế cho Dashboard.
 * - Ưu tiên bảng TrendItem nếu đã có bản ghi.
 * - Nếu chưa có (chế độ Shop-only), fallback minh bạch sang sản phẩm bán chạy nhất
 *   trong DB kèm imageUrl/coverUrl, soldCount, price — tuyệt đối không bịa số liệu.
 */
async function buildDashboardTrendItems(
  productAggregate: Map<
    number,
    {
      id: number;
      title: string;
      imageUrl: string | null;
      shopName: string;
      shopId: number | null;
      category: string | null;
      gmv: number;
      sales: number;
      sellerCount: number;
      price: number;
      previousSales: number;
      capturedAt: Date;
    }
  >,
  topProducts: DashboardOverview['topProducts'],
): Promise<DashboardTrendItem[]> {
  const videos = await prisma.trendItem.findMany({
    orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
    take: 6,
  });

  if (videos.length > 0) {
    return videos.map((video) => {
      const playCount = bigIntToNumber(video.playCount) ?? 0;
      const diggCount = bigIntToNumber(video.diggCount) ?? 0;
      const shareCount = bigIntToNumber(video.shareCount) ?? 0;
      const commentCount = bigIntToNumber(video.commentCount) ?? 0;
      return {
        id: video.id,
        kind: 'video' as const,
        platformVideoId: video.platformVideoId,
        content: video.content,
        author: video.author,
        videoUrl: video.videoUrl,
        coverUrl: video.coverUrl,
        imageUrl: video.coverUrl,
        playCount,
        viewsCount: playCount,
        diggCount,
        shareCount,
        commentCount,
        engagementRate: playCount > 0 ? roundTo(((diggCount + shareCount + commentCount) * 100) / playCount, 2) : 0,
        productId: video.productId,
        shopId: video.shopId,
        soldCount: 0,
        price: 0,
        scrapedAt: toIso(video.scrapedAt),
      };
    });
  }

  const ranked = [...productAggregate.values()]
    .sort((a, b) => b.sales - a.sales || b.gmv - a.gmv)
    .slice(0, 6);

  let fallback: Array<{
    id: number;
    title: string;
    imageUrl: string | null;
    shopName: string;
    shopId: number | null;
    category: string | null;
    gmv: number;
    sales: number;
    sellerCount: number;
    price: number;
    previousSales: number;
    capturedAt: Date;
  }>;

  if (ranked.length > 0) {
    fallback = ranked;
  } else if (topProducts.length > 0) {
    fallback = topProducts.slice(0, 6).map((product) => ({
      id: product.id,
      title: product.title,
      imageUrl: product.imageUrl,
      shopName: product.shopName,
      shopId: product.shopId,
      category: product.category,
      gmv: product.gmv,
      sales: product.sales,
      sellerCount: product.sellerCount,
      price: product.price,
      previousSales: product.sales,
      capturedAt: new Date(),
    }));
  } else {
    // Kỳ lọc không có snapshot (ví dụ "Hôm qua") -> truy vấn trực tiếp DB để vẫn
    // trả về sản phẩm bán chạy nhất thực tế, không để Frontend thiếu trường.
    const rows = await prisma.product.findMany({
      where: { region: 'VN' },
      orderBy: [{ soldCount: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: 6,
      include: {
        shop: { select: { id: true, name: true } },
        productShops: {
          where: { isActive: true },
          orderBy: { lastSeenAt: 'desc' },
          take: 1,
          select: { shop: { select: { id: true, name: true } } },
        },
        snapshots: {
          orderBy: { bucketDate: 'desc' },
          take: 1,
          select: { price: true, gmvTotal: true },
        },
      },
    });

    fallback = rows.map((product) => {
      const shop = product.shop ?? product.productShops[0]?.shop ?? null;
      const latest = product.snapshots[0];
      return {
        id: product.id,
        title: product.title,
        imageUrl: product.imageUrl,
        shopName: shop?.name ?? 'TikTok Shop',
        shopId: shop?.id ?? null,
        category: product.category,
        gmv: decimalToNumber(latest?.gmvTotal) ?? 0,
        sales: bigIntToNumber(product.soldCount) ?? 0,
        sellerCount: product.sellerCount,
        price: decimalToNumber(latest?.price) ?? decimalToNumber(product.minPrice) ?? 0,
        previousSales: 0,
        capturedAt: new Date(),
      };
    });
  }

  return fallback.map((product) => ({
    id: product.id,
    kind: 'product' as const,
    platformVideoId: null,
    content: product.title,
    author: product.shopName,
    videoUrl: null,
    coverUrl: product.imageUrl,
    imageUrl: product.imageUrl,
    playCount: 0,
    viewsCount: 0,
    diggCount: 0,
    shareCount: 0,
    commentCount: 0,
    engagementRate: 0,
    productId: product.id,
    shopId: product.shopId,
    soldCount: product.sales,
    price: product.price,
    scrapedAt: toIso(product.capturedAt),
  }));
}

export async function listScrapeJobs(limit: number, status?: string) {
  const where: Prisma.ScrapeJobWhereInput = status ? { status: status as Prisma.EnumScrapeJobStatusFilter['equals'] } : {};

  const jobs = await prisma.scrapeJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: clampInt(limit, 1, 100, 20),
  });

  return jobs.map((job) => ({
    id: job.id,
    source: job.source,
    jobType: job.jobType,
    trigger: job.trigger,
    region: job.region,
    status: job.status,
    startedAt: toIso(job.startedAt),
    finishedAt: toIso(job.finishedAt),
    durationMs: job.durationMs,
    recordsFound: job.recordsFound,
    recordsSaved: job.recordsSaved,
    recordsUpdated: job.recordsUpdated,
    recordsFailed: job.recordsFailed,
    errorMessage: job.errorMessage,
    createdAt: toIso(job.createdAt),
  }));
}
