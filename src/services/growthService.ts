import type { Prisma } from '@prisma/client';
import prisma from '../config/db.js';
import { GROWTH_WINDOWS, type GrowthWindow } from '../config/constants.js';
import { bigIntToNumber, decimalToNumber, percentChange, roundTo } from '../utils/numbers.js';

export type GrowthDirection = 'up' | 'down' | 'flat';

/** Má»™t má»‘c chÃªnh lá»‡ch (1/7/30/90 ngÃ y) phá»¥c vá»¥ mÅ©i tÃªn tÄƒng trÆ°á»Ÿng. */
export interface GrowthMetric {
  days: GrowthWindow;
  /** ChÃªnh lá»‡ch sá»‘ lÆ°á»£ng bÃ¡n trong N ngÃ y (salesDiff). */
  salesDiff: number;
  /** ChÃªnh lá»‡ch GMV trong N ngÃ y (Delta GMV). */
  gmvDelta: number;
  /** Tá»‘c Ä‘á»™ tÄƒng trÆ°á»Ÿng sá»‘ bÃ¡n (%) so vá»›i má»‘c baseline N ngÃ y trÆ°á»›c. */
  salesGrowthRate: number;
  /** Tá»‘c Ä‘á»™ tÄƒng trÆ°á»Ÿng GMV (%) so vá»›i má»‘c baseline N ngÃ y trÆ°á»›c. */
  gmvGrowthRate: number;
  /** MÅ©i tÃªn hiá»ƒn thá»‹: xanh (up), Ä‘á» (down), xÃ¡m (flat). */
  direction: GrowthDirection;
  /** false khi chÆ°a Ä‘á»§ lá»‹ch sá»­ Ä‘á»ƒ tÃ­nh má»‘c nÃ y. */
  hasData: boolean;
}

export interface GrowthSummary {
  /** Má»‘c Ä‘ang Ä‘Æ°á»£c chá»n theo bá»™ lá»c thá»i gian (1/7/30/90). */
  primary: GrowthMetric;
  metrics: GrowthMetric[];
}

interface SnapshotGrowthRow {
  soldCountTotal: bigint | null;
  gmvTotal: Prisma.Decimal | null;
  soldCount1d: bigint | null;
  soldCount7d: bigint | null;
  soldCount30d: bigint | null;
  soldCount90d: bigint | null;
  gmv1d: Prisma.Decimal | null;
  gmv7d: Prisma.Decimal | null;
  gmv30d: Prisma.Decimal | null;
  gmv90d: Prisma.Decimal | null;
}

const SNAPSHOT_SELECT = {
  soldCountTotal: true,
  gmvTotal: true,
  soldCount1d: true,
  soldCount7d: true,
  soldCount30d: true,
  soldCount90d: true,
  gmv1d: true,
  gmv7d: true,
  gmv30d: true,
  gmv90d: true,
} as const;

/**
 * Chuyá»ƒn snapshot luá»¹ káº¿ (Ä‘Ã£ lÆ°u delta theo má»‘c) thÃ nh bá»™ chá»‰ sá»‘ tÄƒng trÆ°á»Ÿng.
 * KhÃ´ng bá»‹a sá»‘: má»‘c nÃ o thiáº¿u dá»¯ liá»‡u sáº½ cÃ³ `hasData=false` vÃ  delta = 0.
 */
export function buildGrowthFromSnapshot(snapshot: SnapshotGrowthRow | null): GrowthSummary {
  const metrics = GROWTH_WINDOWS.map((days) => toGrowthMetric(snapshot, days));
  return { primary: metrics[0] ?? toGrowthMetric(snapshot, 1), metrics };
}

function toGrowthMetric(snapshot: SnapshotGrowthRow | null, days: GrowthWindow): GrowthMetric {
  const diff = readSoldDiff(snapshot, days);
  const gmvDiff = readGmvDiff(snapshot, days);
  const currentSales = bigIntToNumber(snapshot?.soldCountTotal);
  const currentGmv = decimalToNumber(snapshot?.gmvTotal);

  const hasSalesData = snapshot !== null && diff !== null;
  const hasGmvData = snapshot !== null && gmvDiff !== null;
  const hasData = hasSalesData || hasGmvData;

  const salesDiff = diff ?? 0;
  const gmvDelta = gmvDiff ?? 0;

  const salesGrowthRate =
    hasSalesData && currentSales !== null
      ? percentChange(currentSales, Math.max(0, currentSales - salesDiff))
      : 0;
  const gmvGrowthRate =
    hasGmvData && currentGmv !== null
      ? percentChange(currentGmv, Math.max(0, currentGmv - gmvDelta))
      : 0;

  return {
    days,
    salesDiff,
    gmvDelta,
    salesGrowthRate,
    gmvGrowthRate,
    direction: resolveDirection(hasSalesData ? salesDiff : 0, hasGmvData ? gmvDelta : 0),
    hasData,
  };
}

function readSoldDiff(snapshot: SnapshotGrowthRow | null, days: GrowthWindow): number | null {
  if (!snapshot) return null;
  const column =
    days === 1
      ? snapshot.soldCount1d
      : days === 7
        ? snapshot.soldCount7d
        : days === 30
          ? snapshot.soldCount30d
          : snapshot.soldCount90d;
  return bigIntToNumber(column);
}

function readGmvDiff(snapshot: SnapshotGrowthRow | null, days: GrowthWindow): number | null {
  if (!snapshot) return null;
  const column =
    days === 1
      ? snapshot.gmv1d
      : days === 7
        ? snapshot.gmv7d
        : days === 30
          ? snapshot.gmv30d
          : snapshot.gmv90d;
  return decimalToNumber(column);
}

function resolveDirection(salesDiff: number, gmvDelta: number): GrowthDirection {
  const score = salesDiff > 0 || gmvDelta > 0 ? 1 : salesDiff < 0 || gmvDelta < 0 ? -1 : 0;
  if (score === 0) return 'flat';
  return score > 0 ? 'up' : 'down';
}

/** Chá»n má»‘c theo bá»™ lá»c thá»i gian; 90 ngÃ y váº«n tráº£ Ä‘á»§ 4 má»‘c Ä‘á»ƒ UI hiá»ƒn thá»‹. */
export function pickPrimaryGrowth(summary: GrowthSummary, windowDays: number): GrowthMetric {
  const target = closestWindow(windowDays);
  return summary.metrics.find((metric) => metric.days === target) ?? summary.primary;
}

export function closestWindow(days: number): GrowthWindow {
  let closest: GrowthWindow = 1;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const window of GROWTH_WINDOWS) {
    const diff = Math.abs(window - days);
    if (diff < bestDiff) {
      bestDiff = diff;
      closest = window;
    }
  }

  return closest;
}

/* ------------------------------------------------------------------ */
/* Truy váº¥n DB                                                        */
/* ------------------------------------------------------------------ */

/** TÄƒng trÆ°á»Ÿng cá»§a má»™t sáº£n pháº©m theo snapshot má»›i nháº¥t. */
export async function getProductGrowth(productId: number, source?: string): Promise<GrowthSummary> {
  const snapshot = await prisma.productSnapshot.findFirst({
    where: { productId, ...(source ? { source } : {}) },
    orderBy: [{ bucketDate: 'desc' }, { capturedAt: 'desc' }],
    select: SNAPSHOT_SELECT,
  });

  return buildGrowthFromSnapshot(snapshot);
}

/**
 * TÄƒng trÆ°á»Ÿng tá»•ng há»£p cá»§a shop: cá»™ng delta má»›i nháº¥t cá»§a tá»«ng sáº£n pháº©m
 * (ShopProductSnapshot) vÃ  quy Ä‘á»•i vá» cÃ¹ng thang 1/7/30/90 ngÃ y.
 */
export async function getShopGrowth(shopId: number, source?: string): Promise<GrowthSummary> {
  const rows = await prisma.shopProductSnapshot.findMany({
    where: {
      productShop: { shopId },
      ...(source ? { source } : {}),
    },
    orderBy: [{ bucketDate: 'desc' }, { capturedAt: 'desc' }],
    distinct: ['productShopId'],
    select: {
      soldCountTotal: true,
      gmvTotal: true,
      soldCount1d: true,
      soldCount7d: true,
      soldCount30d: true,
      soldCount90d: true,
      gmv1d: true,
      gmv7d: true,
      gmv30d: true,
      gmv90d: true,
    },
  });

  if (rows.length === 0) return buildGrowthFromSnapshot(null);

  const totals = rows.reduce(
    (acc, row) => {
      acc.soldCountTotal += bigIntToNumber(row.soldCountTotal) ?? 0;
      acc.gmvTotal += decimalToNumber(row.gmvTotal) ?? 0;
      acc.soldCount1d += bigIntToNumber(row.soldCount1d) ?? 0;
      acc.soldCount7d += bigIntToNumber(row.soldCount7d) ?? 0;
      acc.soldCount30d += bigIntToNumber(row.soldCount30d) ?? 0;
      acc.soldCount90d += bigIntToNumber(row.soldCount90d) ?? 0;
      acc.gmv1d += decimalToNumber(row.gmv1d) ?? 0;
      acc.gmv7d += decimalToNumber(row.gmv7d) ?? 0;
      acc.gmv30d += decimalToNumber(row.gmv30d) ?? 0;
      acc.gmv90d += decimalToNumber(row.gmv90d) ?? 0;
      acc.soldHasData = acc.soldHasData || row.soldCount1d !== null;
      acc.gmvHasData = acc.gmvHasData || row.gmv1d !== null;
      return acc;
    },
    {
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
    },
  );

  return buildAggregateGrowth(totals);
}

interface AggregateTotals {
  soldCountTotal: number;
  gmvTotal: number;
  soldCount1d: number;
  soldCount7d: number;
  soldCount30d: number;
  soldCount90d: number;
  gmv1d: number;
  gmv7d: number;
  gmv30d: number;
  gmv90d: number;
  soldHasData: boolean;
  gmvHasData: boolean;
}

/**
 * Dá»±ng GrowthSummary tá»« tá»•ng sá»‘ Ä‘Ã£ cá»™ng dá»“n (dÃ¹ng cho shop & dashboard).
 */
export function buildAggregateGrowth(totals: AggregateTotals): GrowthSummary {
  const metrics = GROWTH_WINDOWS.map((days): GrowthMetric => {
    const salesDiff = readAggregateDiff(totals, days, 'sales');
    const gmvDelta = readAggregateDiff(totals, days, 'gmv');
    return {
      days,
      salesDiff,
      gmvDelta,
      salesGrowthRate: percentChange(totals.soldCountTotal, Math.max(0, totals.soldCountTotal - salesDiff)),
      gmvGrowthRate: percentChange(totals.gmvTotal, Math.max(0, totals.gmvTotal - gmvDelta)),
      direction: resolveDirection(totals.soldHasData ? salesDiff : 0, totals.gmvHasData ? gmvDelta : 0),
      hasData: totals.soldHasData || totals.gmvHasData,
    };
  });

  return { primary: metrics[0] ?? emptyMetric(1), metrics };
}

function readAggregateDiff(totals: AggregateTotals, days: GrowthWindow, kind: 'sales' | 'gmv'): number {
  if (kind === 'sales') {
    return days === 1
      ? totals.soldCount1d
      : days === 7
        ? totals.soldCount7d
        : days === 30
          ? totals.soldCount30d
          : totals.soldCount90d;
  }
  return days === 1 ? totals.gmv1d : days === 7 ? totals.gmv7d : days === 30 ? totals.gmv30d : totals.gmv90d;
}

function emptyMetric(days: GrowthWindow): GrowthMetric {
  return {
    days,
    salesDiff: 0,
    gmvDelta: 0,
    salesGrowthRate: 0,
    gmvGrowthRate: 0,
    direction: 'flat',
    hasData: false,
  };
}

/** LÃ m trÃ²n cÃ¡c trÆ°á»ng sá»‘ cá»§a GrowthMetric Ä‘á»ƒ tráº£ JSON gá»n. */
export function serializeGrowth(summary: GrowthSummary, windowDays: number): GrowthSummary {
  const primary = pickPrimaryGrowth(summary, windowDays);
  const metrics = summary.metrics.map((metric) => ({
    ...metric,
    salesDiff: roundTo(metric.salesDiff, 0),
    gmvDelta: roundTo(metric.gmvDelta, 0),
    salesGrowthRate: roundTo(metric.salesGrowthRate, 2),
    gmvGrowthRate: roundTo(metric.gmvGrowthRate, 2),
  }));

  return {
    primary: metrics.find((metric) => metric.days === primary.days) ?? metrics[0] ?? primary,
    metrics,
  };
}
