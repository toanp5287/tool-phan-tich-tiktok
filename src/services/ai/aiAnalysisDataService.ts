import prisma from '../../config/db.js';
import { env } from '../../config/env.js';
import { bigIntToNumber, decimalToNumber, percentChange, safeDivide } from '../../utils/numbers.js';
import { getPreferredSnapshotsByDate } from '../sourcePriorityService.js';

const MAX_WINDOW_DAYS = 90;

export async function buildProductAnalysisData(productId: number, requestedDays: number) {
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(7, Math.trunc(requestedDays)));
  const snapshotStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      snapshots: { where: { bucketDate: { gte: snapshotStart } }, orderBy: [{ bucketDate: 'asc' }, { capturedAt: 'asc' }], take: 500 },
      variants: { select: { name: true, price: true, isAvailable: true }, take: 100 },
      productShops: {
        orderBy: { lastSeenAt: 'desc' }, take: 30,
        include: { shop: true, snapshots: { where: { bucketDate: { gte: snapshotStart } }, orderBy: [{ bucketDate: 'asc' }, { capturedAt: 'asc' }], take: 200 } },
      },
      trendItems: { orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }], take: 20 },
      creatorLinks: { where: { isActive: true }, orderBy: { gmvTotal: 'desc' }, take: 20, include: { creator: true } },
    },
  });
  if (!product) return null;

  const preferred = Array.from(getPreferredSnapshotsByDate(product.snapshots).values()).slice(-days);
  const trend = preferred.map((s) => ({
    date: s.bucketDate.toISOString().slice(0, 10),
    sales: bigIntToNumber(s.soldCountTotal), gmv: decimalToNumber(s.gmvTotal),
    price: decimalToNumber(s.price), source: s.source, estimated: s.isEstimated,
  }));
  const first = preferred[0];
  const last = preferred.at(-1);
  const salesFirst = bigIntToNumber(first?.soldCountTotal);
  const salesLast = bigIntToNumber(last?.soldCountTotal);
  const gmvFirst = decimalToNumber(first?.gmvTotal);
  const gmvLast = decimalToNumber(last?.gmvTotal);
  const sellers = product.productShops.map((link) => {
    const snaps = link.snapshots;
    const current = snaps.at(-1);
    const previous = snaps.at(-2);
    return {
      shopId: link.shop.id, name: link.shop.name, source: link.shop.source,
      price: decimalToNumber(current?.price), sales: bigIntToNumber(current?.soldCountTotal),
      gmv: current?.isEstimated ? null : decimalToNumber(current?.gmvTotal),
      salesGrowth: current && previous && current.soldCountTotal !== null && previous.soldCountTotal !== null
        ? percentChange(Number(current.soldCountTotal), Number(previous.soldCountTotal)) : null,
      snapshotCount: snaps.length, isEstimated: current?.isEstimated ?? true,
    };
  }).sort((a, b) => (b.sales ?? -1) - (a.sales ?? -1));
  const salesTotal = sellers.reduce((sum, shop) => sum + (shop.sales ?? 0), 0);
  const videos = product.trendItems.map((v) => {
    const views = bigIntToNumber(v.playCount);
    const interactions = [v.diggCount, v.shareCount, v.commentCount].reduce((sum, n) => sum + (bigIntToNumber(n) ?? 0), 0);
    return {
      content: v.content.slice(0, 500), author: v.author, shopId: v.shopId, creatorId: v.creatorId,
      views, likes: bigIntToNumber(v.diggCount), shares: bigIntToNumber(v.shareCount), comments: bigIntToNumber(v.commentCount),
      engagementRate: views && views > 0 ? Math.round(safeDivide(interactions * 100, views) * 100) / 100 : null,
      scrapedAt: v.scrapedAt.toISOString(),
    };
  });
  const creators = product.creatorLinks.map((link) => ({
    name: link.creator.displayName, role: link.creator.role, followers: bigIntToNumber(link.creator.followerCount),
    engagementRate: decimalToNumber(link.creator.engagementRate), sales: bigIntToNumber(link.soldCount),
    gmv: decimalToNumber(link.gmvTotal), videoCount: link.videoCount,
    commissionRate: decimalToNumber(link.commissionRate),
  }));
  const nonEstimatedGmv = preferred.filter((s) => !s.isEstimated && s.gmvTotal !== null);
  const recent = preferred.slice(-Math.min(7, preferred.length));
  const historicalDays = new Set(preferred.map((s) => s.bucketDate.toISOString().slice(0, 10))).size;
  const firstDate = preferred[0]?.bucketDate;
  const lastDate = preferred.at(-1)?.bucketDate;
  const actualCoverageDays = firstDate && lastDate ? Math.floor((lastDate.getTime() - firstDate.getTime()) / 86_400_000) + 1 : 0;
  const hasFullRequestedWindowCoverage = actualCoverageDays >= days;
  const hasFull30DayCoverage = actualCoverageDays >= 30;
  const dataQuality = {
    requestedWindowDays: days, snapshotDays: historicalDays, latestSnapshotAt: last?.capturedAt.toISOString() ?? null,
    trendVideoCount: videos.length, sellerCount: sellers.length, creatorCount: creators.length,
    verifiedGmvSnapshotCount: nonEstimatedGmv.length,
    actualCoverageDays, hasFullRequestedWindowCoverage, hasFull30DayCoverage,
    salesGrowth: salesFirst !== null && salesLast !== null && first !== last && hasFullRequestedWindowCoverage ? percentChange(salesLast, salesFirst) : null,
    gmvGrowth: gmvFirst !== null && gmvLast !== null && nonEstimatedGmv.length >= 2 && hasFullRequestedWindowCoverage ? percentChange(gmvLast, gmvFirst) : null,
    recentSalesDelta: recent.length > 1 && recent.at(-1)?.soldCountTotal !== null && recent[0]?.soldCountTotal !== null
      ? Number(recent.at(-1)?.soldCountTotal) - Number(recent[0]?.soldCountTotal) : null,
    topShopSalesShare: salesTotal > 0 ? Math.round((sellers[0]?.sales ?? 0) / salesTotal * 10000) / 100 : null,
    limitations: [
      nonEstimatedGmv.length < 2 ? 'GMV trend has insufficient verified non-estimated snapshots.' : null,
      videos.length === 0 ? 'No linked TrendItem video data.' : null,
      creators.length === 0 ? 'No linked creator/affiliate data.' : null,
      historicalDays < 7 ? 'Fewer than 7 distinct snapshot days.' : null,
      !hasFullRequestedWindowCoverage ? `Snapshot coverage is shorter than the requested ${days}-day window; growth is unavailable.` : null,
      !hasFull30DayCoverage ? 'Snapshot coverage is shorter than 30 days; 30-day growth is unavailable.' : null,
    ].filter(Boolean),
  };
  return {
    product: {
      id: product.id, title: product.title.slice(0, 300), description: product.description?.slice(0, 1200) ?? null,
      category: product.category, subCategory: product.subCategory, region: product.region, currency: product.currency,
      minPrice: decimalToNumber(product.minPrice), maxPrice: decimalToNumber(product.maxPrice),
      rating: decimalToNumber(product.ratingScore), ratingCount: bigIntToNumber(product.ratingCount),
      soldCount: bigIntToNumber(product.soldCount), sellerCount: product.sellerCount, source: product.source,
      firstSeenAt: product.firstSeenAt.toISOString(), lastSeenAt: product.lastSeenAt.toISOString(),
      variants: product.variants.map((v) => ({ name: v.name?.slice(0, 100) ?? null, price: decimalToNumber(v.price), available: v.isAvailable })),
    },
    dataQuality, trend, sellers, videos, creators,
    analysisLimits: { maxInputChars: env.gemini.maxInputChars },
  };
}
