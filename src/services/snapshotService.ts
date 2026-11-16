/**
 * Daily metric snapshot service (90-day history accumulation).
 *
 * Honest by design:
 * - Captures real observed values with a real bucketDate (today), never fabricates
 *   past history.
 * - For the video/creator metrics that DO have real dated observations in
 *   VideoObservation/CreatorChannelObservation, backfills from those real timestamps.
 * - For products/shops (no dated history), records a single baseline snapshot today
 *   as the starting point; history accumulates from here.
 */

import { datasetDb as db } from '../config/datasetDb.js';
import { createLogger } from '../utils/logger.js';
import { datasetDay } from './analytics.js';
import { SIMULATION_SOURCE, metadataFor, scenarioForKey, simulateSeries, simulateCompetition } from './simulation/simulationEngine.js';
import type { Prisma } from '../../generated/v2/index.js';

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const logger = createLogger('snapshot');

export type SnapshotMetric = 'soldCount' | 'price' | 'gmv' | 'followers' | 'views' | 'likes' | 'productCount' | 'videoCount';

interface SnapshotInput {
  entityType: string;
  entityId: number;
  metric: string;
  value: string | number | null;
  currency?: string | null;
  bucketDate: Date;
  source: string;
  verificationStatus: 'VERIFIED' | 'SUGGESTED' | 'NEEDS_REVIEW';
  confidence?: number | null;
  isEstimated?: boolean;
  metadata?: Prisma.InputJsonValue;
}

async function upsertSnapshot(input: SnapshotInput): Promise<void> {
  if (input.value === null || input.value === undefined || input.value === '') return;
  const value = typeof input.value === 'number' ? String(input.value) : input.value;
  await db.metricSnapshot.upsert({
    where: {
      entityType_entityId_metric_bucketDate_source: {
        entityType: input.entityType,
        entityId: input.entityId,
        metric: input.metric,
        bucketDate: input.bucketDate,
        source: input.source,
      },
    },
    update: {
      value,
      currency: input.currency ?? null,
      verificationStatus: input.verificationStatus,
      confidence: input.confidence ?? null,
      isEstimated: input.isEstimated ?? false,
      metadata: input.metadata ?? undefined,
      observedAt: new Date(),
    },
    create: {      entityType: input.entityType,
      entityId: input.entityId,
      metric: input.metric,
      value,
      currency: input.currency ?? null,
      observedAt: new Date(),
      bucketDate: input.bucketDate,
      source: input.source,
      verificationStatus: input.verificationStatus,
      confidence: input.confidence ?? null,
      isEstimated: input.isEstimated ?? false,
      metadata: input.metadata ?? undefined,
    },
  });
}

/** Capture today's baseline snapshot for products (sold count, price, estimated GMV). */
export async function captureProductBaselines(batchSize = 500): Promise<{ scanned: number; snapshots: number }> {
  const today = new Date();
  const bucketDate = new Date(datasetDay(today) + 'T00:00:00.000Z');
  let cursor = 0;
  let scanned = 0;
  let snapshots = 0;

  while (true) {
    const products = await db.product.findMany({
      select: {
        id: true,
        currency: true,
        observations: { orderBy: [{ observedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], take: 1 },
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      skip: cursor,
    });
    if (!products.length) break;
    for (const product of products) {
      scanned += 1;
      const obs = product.observations[0];
      if (!obs) continue;
      const sold = obs.soldCount;
      const price = obs.price;
      if (sold !== null) { await upsertSnapshot({ entityType: 'PRODUCT', entityId: product.id, metric: 'soldCount', value: sold.toString(), currency: product.currency, bucketDate, source: 'dataset-v2', verificationStatus: 'NEEDS_REVIEW', isEstimated: false }); snapshots += 1; }
      if (price !== null) { await upsertSnapshot({ entityType: 'PRODUCT', entityId: product.id, metric: 'price', value: price.toString(), currency: obs.currency ?? product.currency, bucketDate, source: 'dataset-v2', verificationStatus: 'NEEDS_REVIEW', isEstimated: false }); snapshots += 1; }
      if (sold !== null && price !== null) {
        const gmv = Number(sold) * Number(price);
        if (Number.isFinite(gmv)) { await upsertSnapshot({ entityType: 'PRODUCT', entityId: product.id, metric: 'gmv', value: gmv.toString(), currency: product.currency, bucketDate, source: 'dataset-v2', verificationStatus: 'NEEDS_REVIEW', isEstimated: true }); snapshots += 1; }
      }
    }
    cursor += products.length;
  }
  return { scanned, snapshots };
}

/** Capture today's baseline for shops (product count). */
export async function captureShopBaselines(batchSize = 500): Promise<{ scanned: number; snapshots: number }> {
  const today = new Date();
  const bucketDate = new Date(datasetDay(today) + 'T00:00:00.000Z');
  let cursor = 0;
  let scanned = 0;
  let snapshots = 0;

  while (true) {
    const shops = await db.shop.findMany({
      select: { id: true, _count: { select: { products: { where: { isActive: true, verificationStatus: 'VERIFIED' } } } } },
      orderBy: { id: 'asc' },
      take: batchSize,
      skip: cursor,
    });
    if (!shops.length) break;
    for (const shop of shops) {
      scanned += 1;
      await upsertSnapshot({ entityType: 'SHOP', entityId: shop.id, metric: 'productCount', value: String(shop._count.products), bucketDate, source: 'dataset-v2', verificationStatus: 'VERIFIED', isEstimated: false });
      snapshots += 1;
    }
    cursor += shops.length;
  }
  return { scanned, snapshots };
}

/** Backfill real dated video/creator observations into snapshots (already have timestamps). */
export async function backfillVideoCreatorHistory(batchSize = 2000): Promise<{ video: number; creator: number }> {
  let video = 0;
  let creator = 0;

  // Video observations already have observedAt (vitied source, ~9 days).
  let cursor: bigint = 0n;
  while (true) {
    const rows = await db.videoObservation.findMany({
      where: { observedAt: { not: null }, id: { gt: cursor } },
      select: { id: true, videoId: true, observedAt: true, playCount: true, diggCount: true, shareCount: true, commentCount: true, record: { select: { file: { select: { source: { select: { code: true } } } } } } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (row.observedAt === null) continue;
      const bucketDate = new Date(datasetDay(row.observedAt) + 'T00:00:00.000Z');
      const source = row.record.file.source.code;
      for (const [metric, value] of [['views', row.playCount], ['likes', row.diggCount], ['shares', row.shareCount], ['comments', row.commentCount]] as const) {
        if (value !== null) { await upsertSnapshot({ entityType: 'VIDEO', entityId: row.videoId, metric, value: value.toString(), bucketDate, source, verificationStatus: 'SUGGESTED', isEstimated: false }); video += 1; }
      }
    }
    cursor = rows.at(-1)!.id;
  }

  // Creator channel observations (followers/likes).
  cursor = 0n;
  while (true) {
    const rows = await db.creatorChannelObservation.findMany({
      where: { observedAt: { not: null }, id: { gt: cursor } },
      select: { id: true, channelId: true, observedAt: true, followerCount: true, likeCount: true, record: { select: { file: { select: { source: { select: { code: true } } } } } } },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const row of rows) {
      if (row.observedAt === null) continue;
      const bucketDate = new Date(datasetDay(row.observedAt) + 'T00:00:00.000Z');
      const source = row.record.file.source.code;
      for (const [metric, value] of [['followers', row.followerCount], ['likes', row.likeCount]] as const) {
        if (value !== null) { await upsertSnapshot({ entityType: 'CREATOR', entityId: row.channelId, metric, value: value.toString(), bucketDate, source, verificationStatus: 'SUGGESTED', isEstimated: false }); creator += 1; }
      }
    }
    cursor = rows.at(-1)!.id;
  }
  return { video, creator };
}

/** Run the full idempotent snapshot capture/backfill. */
export async function runSnapshotCapture(): Promise<{ products: { scanned: number; snapshots: number }; shops: { scanned: number; snapshots: number }; history: { video: number; creator: number } }> {
  const products = await captureProductBaselines();
  const shops = await captureShopBaselines();
  const history = await backfillVideoCreatorHistory();
  logger.info(`Snapshot: products=${products.snapshots}, shops=${shops.snapshots}, video=${history.video}, creator=${history.creator}`);
  return { products, shops, history };
}

/**
 * Generate 90 days of SIMULATED daily snapshots for products and shops.
 *
 * - Anchored to the latest real ProductObservation.soldCount/price (never divided evenly).
 * - source='simulated' keeps rows separate from VERIFIED (dataset-v2 / vitied) rows.
 * - Upsert is idempotent: same deterministic values on re-run; no duplicates.
 * - Shops reconcile with products: product daily units are split across its linked
 *   shops by a simulated time-varying share (sum of shop units == product units),
 *   so shop totals never double-count a product that has multiple sellers.
 */
export async function captureSimulatedHistory(days = 90): Promise<{ products: number; shops: number; snapshots: number }> {
  const endDate = new Date();
  const bucketFor = (iso: string) => new Date(iso + 'T00:00:00.000Z');

  const products = await db.product.findMany({
    select: {
      id: true,
      currency: true,
      observations: { orderBy: [{ observedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], take: 1 },
    },
    orderBy: { id: 'asc' },
  });

  const productSeries = new Map<number, ReturnType<typeof simulateSeries>>();
  const productCurrency = new Map<number, string | null>();
  const rows: Prisma.MetricSnapshotCreateManyInput[] = [];
  const push = (entityType: string, entityId: number, metric: string, value: number, currency: string | null, bucketDate: Date, meta: ReturnType<typeof metadataFor>) => {
    rows.push({
      entityType, entityId, metric, value: String(value), currency, bucketDate,
      source: SIMULATION_SOURCE, verificationStatus: 'NEEDS_REVIEW', isEstimated: true,
      observedAt: new Date(), metadata: meta as Prisma.InputJsonValue,
    });
  };

  for (const product of products) {
    const obs = product.observations[0];
    if (!obs || obs.soldCount === null || obs.price === null) continue;
    const anchorSold = Number(obs.soldCount);
    const anchorPrice = Number(obs.price);
    if (!Number.isFinite(anchorSold) || !Number.isFinite(anchorPrice) || anchorSold < 0 || anchorPrice <= 0) continue;

    const seedKey = `product:${product.id}`;
    const scenario = scenarioForKey(seedKey);
    const series = simulateSeries({ scenario, anchorSold, anchorPrice }, days, endDate, seedKey);
    productSeries.set(product.id, series);
    productCurrency.set(product.id, obs.currency ?? product.currency);

    for (const point of series) {
      const bucketDate = bucketFor(point.bucketDate);
      const currency = obs.currency ?? product.currency;
      const meta = metadataFor({ scenario, anchorSold, anchorPrice }, seedKey);
      push('PRODUCT', product.id, 'soldCount', point.soldCount, currency, bucketDate, meta);
      push('PRODUCT', product.id, 'price', point.price, currency, bucketDate, meta);
      push('PRODUCT', product.id, 'gmv', point.gmv, currency, bucketDate, meta);
    }
  }

  // Shops: reconcile with linked products via per-shop simulated shares.
  const shopLinks = await db.productShop.findMany({
    where: { verificationStatus: 'VERIFIED', isActive: true },
    select: { productId: true, shopId: true },
  });
  // productId -> ordered list of linked shopIds (stable order).
  const productShops = new Map<number, number[]>();
  for (const link of shopLinks) {
    const list = productShops.get(link.productId) ?? [];
    list.push(link.shopId);
    productShops.set(link.productId, list);
  }

  // Precompute per-product competition share series.
  const competitionByProduct = new Map<number, ReturnType<typeof simulateCompetition>>();
  for (const [productId, shopIds] of productShops) {
    if (!productSeries.has(productId)) continue;
    const sorted = [...shopIds].sort((a, b) => a - b);
    competitionByProduct.set(productId, simulateCompetition(sorted, days, endDate, `product:${productId}`));
  }

  // Aggregate per-shop daily units/gmv using the product's share that belongs to this shop.
  const shopDaily = new Map<number, Map<string, { units: number; weightedPriceSum: number; gmv: number }>>();
  for (const [productId, series] of productSeries) {
    const comp = competitionByProduct.get(productId);
    if (!comp) continue;
    const sortedShops = productShops.get(productId)!;
    const priceByDay = new Map(series.map((p) => [p.bucketDate, p.price]));
    for (let i = 0; i < comp.length; i++) {
      const point = series[i];
      if (!point) continue;
      const shares = comp[i]!.shares;
      const price = priceByDay.get(point.bucketDate) ?? 0;
      for (let s = 0; s < sortedShops.length; s++) {
        const shopId = sortedShops[s]!;
        const share = shares[s] ?? 0;
        const units = roundInt(point.dailyUnits * share);
        const gmv = roundMoney(point.dailyUnits * share * price);
        const dayMap = shopDaily.get(shopId) ?? new Map<string, { units: number; weightedPriceSum: number; gmv: number }>();
        const entry = dayMap.get(point.bucketDate) ?? { units: 0, weightedPriceSum: 0, gmv: 0 };
        entry.units += units;
        entry.weightedPriceSum += price * units;
        entry.gmv += gmv;
        dayMap.set(point.bucketDate, entry);
        shopDaily.set(shopId, dayMap);
      }
    }
  }

  let shopsDone = 0;
  for (const [shopId, dayMap] of shopDaily) {
    const daysSorted = [...dayMap.keys()].sort();
    let cumulative = 0;
    let cumulativeGmv = 0;
    const seedKey = `shop:${shopId}`;
    const scenario = scenarioForKey(seedKey);
    for (const day of daysSorted) {
      const entry = dayMap.get(day)!;
      cumulative += entry.units;
      cumulativeGmv += entry.gmv;
      const price = entry.units > 0 ? entry.weightedPriceSum / entry.units : 0;
      const meta = metadataFor({ scenario, anchorSold: cumulative, anchorPrice: price }, seedKey);
      const bucketDate = bucketFor(day);
      push('SHOP', shopId, 'soldCount', cumulative, null, bucketDate, meta);
      push('SHOP', shopId, 'price', price, null, bucketDate, meta);
      push('SHOP', shopId, 'gmv', roundMoney(cumulativeGmv), null, bucketDate, meta);
    }
    shopsDone += 1;
  }

  // Competition metrics per product (topShopShare, concentration HHI).
  for (const [productId, comp] of competitionByProduct) {
    const currency = productCurrency.get(productId) ?? null;
    for (const point of comp) {
      const bucketDate = bucketFor(point.bucketDate);
      const meta = metadataFor({ scenario: 'STABLE', anchorSold: 0, anchorPrice: 0 }, `product:${productId}:competition`);
      const top = String(point.topShopShare);
      const hhi = String(point.hhi);
      const count = String(point.shopCount);
      const isPrimary = String(point.shopCount > 0 ? 1 : 0);
      rows.push({
        entityType: 'PRODUCT', entityId: productId, metric: 'topShopShare', value: top, currency, bucketDate,
        source: SIMULATION_SOURCE, verificationStatus: 'NEEDS_REVIEW', isEstimated: true, observedAt: new Date(),
        metadata: { ...meta, shopCount: point.shopCount } as Prisma.InputJsonValue,
      });
      rows.push({
        entityType: 'PRODUCT', entityId: productId, metric: 'concentrationHhi', value: hhi, currency, bucketDate,
        source: SIMULATION_SOURCE, verificationStatus: 'NEEDS_REVIEW', isEstimated: true, observedAt: new Date(),
        metadata: { ...meta, shopCount: point.shopCount } as Prisma.InputJsonValue,
      });
      rows.push({
        entityType: 'PRODUCT', entityId: productId, metric: 'sellerCount', value: count, currency, bucketDate,
        source: SIMULATION_SOURCE, verificationStatus: 'NEEDS_REVIEW', isEstimated: true, observedAt: new Date(),
        metadata: { ...meta, shopCount: point.shopCount, isPrimary } as Prisma.InputJsonValue,
      });
    }
  }

  // Batch insert in chunks; skipDuplicates keeps it idempotent against the unique key.
  const CHUNK = 5000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.metricSnapshot.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  }

  logger.info(`Simulated history: ${productSeries.size} products, ${shopsDone} shops, ${rows.length} snapshot rows`);
  return { products: productSeries.size, shops: shopsDone, snapshots: rows.length };
}

function roundInt(value: number): number {
  return Math.round(value);
}

export interface HistoryPoint { date: string; value: number | null }

/** Read a metric's dated series (ascending by day), returning cumulative values. */
export async function readMetricSeries(entityType: string, entityId: number, metric: string): Promise<HistoryPoint[]> {
  const rows = await db.metricSnapshot.findMany({
    where: { entityType, entityId, metric },
    orderBy: { bucketDate: 'asc' },
    select: { bucketDate: true, value: true },
  });
  const byDay = new Map<string, string>();
  for (const row of rows) byDay.set(datasetDay(row.bucketDate), row.value === null ? '' : String(row.value));
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: value === '' ? null : Number(value) }));
}

/**
 * Compute daily increments for a cumulative metric. Returns null on anomalous
 * decreases (possible reset) rather than fabricating negative sales.
 */
export function dailyIncrements(series: HistoryPoint[]): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  let prev: number | null = null;
  for (const point of series) {
    if (point.value === null) { out.push({ date: point.date, value: null }); prev = null; continue; }
    if (prev === null) { out.push({ date: point.date, value: null }); prev = point.value; continue; }
    const delta = point.value - prev;
    out.push({ date: point.date, value: delta >= 0 ? delta : null });
    prev = point.value;
  }
  return out;
}

/** Growth rate over a window given a cumulative series; null when no valid baseline. */
export function growthRate(series: HistoryPoint[], days: number): number | null {
  const points = series.filter((p) => p.value !== null);
  if (points.length < 2) return null;
  const end = points.at(-1)!;
  const start = points[0]!;
  if (start.value === null || end.value === null || start.value <= 0) return null;
  return (end.value - start.value) / start.value;
}
