import prisma from '../../config/db.js';
import { addDays, buildAnalyticsWindow, isoDateKey } from '../../utils/dates.js';
import { roundTo, safeDivide } from '../../utils/numbers.js';
import {
  buildMultiPeriodAggregate,
  createAccumulator,
  accumulate,
  currentAnchor,
  periodWindows,
  valueAt,
} from './metrics.js';
import {
  buildProductGrowth,
  toCumulativePoint,
  toProductCard,
  toTrendVideo,
} from './commerceRepository.js';
import { getTopCommerceCreators } from './creatorService.js';
import { listCommerceShops } from './shopService.js';
import { listCommerceCategories } from './categoryService.js';
import type {
  RangeMeta,
  ShopCommerceHome,
  ShopCommerceHomeTrendItem,
  ShopCommerceProductCard,
  ShopCommerceShopCard,
} from './shopCommerceTypes.js';

const REGION = 'VN';
const TOP_PRODUCTS = 100;
const TOP_TREND_ITEMS = 6;

export async function getCommerceHome(range: RangeMeta): Promise<ShopCommerceHome> {
  const now = new Date();
  const days = range.days;
  const anchor = range.anchor;
  const windows = periodWindows(now, anchor);
  const lookbackStart = windows[windows.length - 1]?.previousBase ?? now;
  const rangeWindow = buildAnalyticsWindow(days, now, anchor);

  const products = await prisma.product.findMany({
    where: { region: REGION },
    include: {
      productShops: {
        where: { isActive: true },
        orderBy: { lastSeenAt: 'desc' },
        take: 1,
        select: { shop: { select: { id: true, name: true, avatarUrl: true } } },
      },
      snapshots: {
        where: { bucketDate: { gte: lookbackStart } },
        select: {
          bucketDate: true,
          capturedAt: true,
          price: true,
          soldCountTotal: true,
          gmvTotal: true,
          stockTotal: true,
          ratingScore: true,
          ratingCount: true,
          playCount: true,
          diggCount: true,
          shareCount: true,
          commentCount: true,
        },
        orderBy: { bucketDate: 'asc' },
      },
    },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
  });

  const accumulators = new Map<number, ReturnType<typeof createAccumulator>>();
  for (const window of windows) accumulators.set(window.days, createAccumulator());

  const dailyGmv = new Map<string, number>();
  const productCards: ShopCommerceProductCard[] = [];

  for (const product of products) {
    const series = product.snapshots.map(toCumulativePoint);
    const latest = valueAt(series, currentAnchor(now, anchor));
    const growth = buildProductGrowth({ productId: product.id, series, latest, previous: null }, now, range);

    for (const window of windows) {
      const acc = accumulators.get(window.days);
      if (acc) accumulate(acc, series, window);
    }

    // Doanh thu GMV theo mốc bucketDate = price × ΔsoldCount so với mốc liền trước.
    // Khi chưa có baseline trước cửa sổ, dùng price × soldCount của mốc đầu tiên
    // để biểu đồ vẫn phản ánh doanh thu thật thay vì 0.
    const baseline = valueAt(series, addDays(rangeWindow.currentStart, -1));
    let previousSold = baseline?.sold ?? null;

    for (const point of series) {
      if (point.bucketDate.getTime() < rangeWindow.currentStart.getTime()) {
        previousSold = point.sold;
        continue;
      }
      if (point.bucketDate.getTime() > rangeWindow.currentEnd.getTime()) break;

      const key = isoDateKey(point.bucketDate);
      const soldDelta = previousSold === null ? point.sold : Math.max(0, point.sold - previousSold);
      dailyGmv.set(key, (dailyGmv.get(key) ?? 0) + point.price * soldDelta);
      previousSold = point.sold;
    }

    productCards.push(
      toProductCard(product, { productId: product.id, series, latest, previous: null }, growth),
    );
  }

  const growth = buildMultiPeriodAggregate(accumulators, windows, days);
  const totalGmv = productCards.reduce((sum, item) => sum + item.gmv, 0);
  const totalSales = productCards.reduce((sum, item) => sum + item.soldCount, 0);

  const [shopCount, creatorCount, videoCount, topShops, topCreators, videos, categories] = await Promise.all([
    prisma.shop.count({ where: { region: REGION } }),
    prisma.creator.count({ where: { region: REGION } }),
    prisma.trendItem.count(),
    listCommerceShops({ page: 1, pageSize: 10, range, sortBy: 'gmv', sortDir: 'desc' }).then((result) => result.items),
    getTopCommerceCreators(now, range, 10),
    prisma.trendItem.findMany({ orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }], take: TOP_TREND_ITEMS }),
    listCommerceCategories(now, range),
  ]);

  const sortedBySales = [...productCards].sort((a, b) => b.soldCount - a.soldCount || b.gmv - a.gmv);
  const topTrendVideos: ShopCommerceHomeTrendItem[] =
    videos.length > 0
      ? videos.map((row) => ({
          ...toTrendVideo(row),
          kind: 'video',
          imageUrl: null,
          soldCount: 0,
          price: 0,
        }))
      : sortedBySales.slice(0, TOP_TREND_ITEMS).map(toProductTrendCard);

  const revenueTimeline = rangeWindow.daysList.map((day) => {
    const key = isoDateKey(day);
    return { date: key, value: roundTo(dailyGmv.get(key) ?? 0, 0) };
  });

  return {
    range,
    totals: {
      products: productCards.length,
      shops: shopCount,
      creators: creatorCount,
      trendVideos: videoCount,
      totalGmv: roundTo(totalGmv, 0),
      totalSales,
      avgOrderValue: totalSales > 0 ? roundTo(safeDivide(totalGmv, totalSales), 0) : 0,
    },
    growth,
    topProducts: [...productCards].sort((a, b) => b.gmv - a.gmv).slice(0, TOP_PRODUCTS),
    topShops: topShops as ShopCommerceShopCard[],
    topCreators,
    topTrendVideos,
    revenueTimeline,
    topCategories: categories.slice(0, 8),
  };
}

/**
 * Fallback minh bạch khi bảng TrendItem chưa có bản ghi: dùng chính sản phẩm
 * bán chạy nhất trong DB (kèm imageUrl/coverUrl, soldCount, price). Không bịa video.
 */
function toProductTrendCard(product: ShopCommerceProductCard): ShopCommerceHomeTrendItem {
  return {
    id: product.id,
    kind: 'product',
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
    soldCount: product.soldCount,
    price: product.price,
    scrapedAt: product.lastSeenAt,
  };
}
