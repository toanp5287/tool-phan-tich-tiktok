import { datasetDb as db } from '../../config/datasetDb.js';
import { AppError } from '../../utils/errors.js';
import {
  parseMode,
  readSeries,
  buildGrowthSummary,
  coverage,
  type AnalysisMode,
} from '../analyticsService.js';
import { percentile } from '../ai/opportunityScoring.js';
import {
  scoreOpportunity,
  logScaleScore,
  growthScore,
  competitionGapScore,
  stabilityScore,
  creatorOpportunityScore,
  type CriterionInput,
} from './opportunityScoringEngine.js';
import { classifyOpportunity, competitionLevel, type OpportunityClassification } from './opportunityClassification.js';

export interface MarketOpportunityRequest {
  market: string | null;
  categoryId?: number;
  subCategoryId?: number;
  days: number;
  mode: AnalysisMode;
}

export interface NicheOpportunity {
  key: string;
  categoryId: number | null;
  subCategoryId: number | null;
  name: string;
  productCount: number;
  shopCount: number | null;
  creatorCount: number | null;
  totalSales: number | null;
  totalGmv: number | null;
  avgPrice: number | null;
  growth30d: number | null;
  growth7d: number | null;
  topShopShare: number | null;
  concentration: number | null;
  competitionLevel: ReturnType<typeof competitionLevel>;
  opportunityScore: number | null;
  confidence: number;
  classification: OpportunityClassification;
  scoredCriteria: string[];
  missing: string[];
  coveragePoints: number;
  positiveFactors: string[];
  negativeFactors: string[];
  reasons: string[];
  limitation: string;
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

interface ProductRow {
  id: number;
  title: string;
  imageUrl: string | null;
  currency: string | null;
}

async function loadCategoryProducts(categoryId: number, subCategoryId: number | undefined, market: string | null): Promise<ProductRow[]> {
  const where = {
    ...(market !== null ? { market } : {}),
    categories: { some: { categoryId, ...(subCategoryId ? { subCategoryId } : {}), isPrimary: true } },
  };
  return db.product.findMany({ where, select: { id: true, title: true, imageUrl: true, currency: true }, orderBy: { id: 'asc' } });
}

/** Aggregate a per-product series across all products in the niche (sum by day). */
async function aggregateSeries(products: ProductRow[], metric: string, mode: AnalysisMode): Promise<Map<string, number>> {
  const byDay = new Map<string, number>();
  for (const product of products) {
    const series = await readSeries('PRODUCT', product.id, metric, mode);
    for (const point of series) {
      if (point.value === null) continue;
      byDay.set(point.date, (byDay.get(point.date) ?? 0) + point.value);
    }
  }
  return byDay;
}

/** Competition across the niche: number of shops + top-shop share (SIMULATION) or just count (REAL_DATA). */
async function aggregateCompetition(products: ProductRow[], mode: AnalysisMode): Promise<{ shopCount: number | null; topShopShare: number | null; concentration: number | null; creatorCount: number | null }> {
  const productIds = products.map((p) => p.id);
  if (!productIds.length) return { shopCount: null, topShopShare: null, concentration: null, creatorCount: null };

  if (mode === 'SIMULATION') {
    const shops = await db.productShop.findMany({ where: { productId: { in: productIds }, isSimulated: true, isActive: true }, select: { shopId: true } });
    const creators = await db.productCreator.findMany({ where: { productId: { in: productIds }, isSimulated: true }, select: { creatorId: true } });
    const distinctShops = new Set(shops.map((s) => s.shopId)).size;
    const distinctCreators = new Set(creators.map((c) => c.creatorId)).size;

    // Top-shop share: read each product's simulated topShopShare, average across products.
    const shares: number[] = [];
    for (const product of products) {
      const series = await readSeries('PRODUCT', product.id, 'topShopShare', mode);
      const last = [...series].reverse().find((p) => p.value !== null)?.value;
      if (last !== null && last !== undefined) shares.push(last);
    }
    const topShopShare = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
    const concentration = shares.length ? shares.map((s) => s * s).reduce((a, b) => a + b, 0) / shares.length : null;
    return { shopCount: distinctShops || null, topShopShare, concentration, creatorCount: distinctCreators || null };
  }

  const shops = await db.productShop.findMany({ where: { productId: { in: productIds }, verificationStatus: 'VERIFIED', isActive: true, isSimulated: false }, select: { shopId: true } });
  const creators = await db.productCreator.findMany({ where: { productId: { in: productIds }, verificationStatus: 'VERIFIED', isSimulated: false }, select: { creatorId: true } });
  return {
    shopCount: new Set(shops.map((s) => s.shopId)).size || null,
    topShopShare: null,
    concentration: null,
    creatorCount: new Set(creators.map((c) => c.creatorId)).size || null,
  };
}

export async function discoverMarketOpportunities(input: MarketOpportunityRequest): Promise<NicheOpportunity[]> {
  const mode = parseMode(input.mode);
  const days = Math.min(90, Math.max(7, Math.trunc(input.days || 30)));

  const categories = await db.category.findMany({ orderBy: { name: 'asc' }, include: { subCategories: { orderBy: { name: 'asc' } } } });
  const niches: NicheOpportunity[] = [];

  // Decide grouping: subcategory-level if categories have subcategories, else category-level.
  for (const category of categories) {
    if (input.categoryId !== undefined && category.id !== input.categoryId) continue;

    const subs = category.subCategories;
    if (input.subCategoryId !== undefined) {
      const sub = subs.find((s) => s.id === input.subCategoryId);
      if (sub) await computeAndPush(niches, { categoryId: category.id, subCategoryId: sub.id, name: `${category.name} › ${sub.name}` }, input, mode, days);
    } else if (subs.length) {
      for (const sub of subs) {
        await computeAndPush(niches, { categoryId: category.id, subCategoryId: sub.id, name: `${category.name} › ${sub.name}` }, input, mode, days);
      }
    } else {
      await computeAndPush(niches, { categoryId: category.id, subCategoryId: undefined, name: category.name }, input, mode, days);
    }
  }

  return niches;
}

async function computeAndPush(
  out: NicheOpportunity[],
  scope: { categoryId: number; subCategoryId: number | undefined; name: string },
  input: MarketOpportunityRequest,
  mode: AnalysisMode,
  days: number,
): Promise<void> {
  const products = await loadCategoryProducts(scope.categoryId, scope.subCategoryId, input.market);
  if (!products.length) return;

  const [salesByDay, gmvByDay, priceByDay] = await Promise.all([
    aggregateSeries(products, 'soldCount', mode),
    aggregateSeries(products, 'gmv', mode),
    aggregateSeries(products, 'price', mode),
  ]);

  // Current totals (latest day value).
  const latestDay = [...salesByDay.keys()].sort().at(-1) ?? null;
  const totalSales = latestDay ? salesByDay.get(latestDay) ?? null : null;
  const totalGmv = latestDay ? gmvByDay.get(latestDay) ?? null : null;
  const priceValues = [...priceByDay.values()].filter((v) => v !== null && v !== undefined);
  const avgPrice = priceValues.length ? priceValues.reduce((a, b) => a + b, 0) / priceValues.length : null;

  // Growth via buildGrowthSummary on aggregated series.
  const salesSeries = [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value, source: '', isEstimated: mode === 'SIMULATION', dataKind: (mode === 'SIMULATION' ? 'SIMULATED' : 'VERIFIED') as never }));
  const gmvSeries = [...gmvByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value, source: '', isEstimated: mode === 'SIMULATION', dataKind: (mode === 'SIMULATION' ? 'SIMULATED' : 'VERIFIED') as never }));
  const growth = buildGrowthSummary(salesSeries, gmvSeries, days);
  const growth30 = growth.periods.find((p) => p.days === 30);
  const growth7 = growth.periods.find((p) => p.days === 7);

  const { shopCount, topShopShare, concentration, creatorCount } = await aggregateCompetition(products, mode);

  // Stability from daily increments of aggregated sales.
  const dailyIncrements = computeIncrements(salesByDay);
  const stability = stabilityScore(dailyIncrements);

  // Demand/commercial scores via log-scale.
  const demandScore = logScaleScore(totalSales, 10, 20);
  const commercialScore = logScaleScore(totalGmv, 10, 15);
  const competitionScore = competitionGapScore(topShopShare);
  const creatorScore = creatorOpportunityScore(creatorCount, demandScore);

  // Confidence: fraction of core inputs available.
  const inputs: CriterionInput[] = [
    { key: 'demand', label: 'Market Demand', weight: 20, value: demandScore, formula: 'log10(soldCount+1)×20' },
    { key: 'growth', label: 'Growth Momentum', weight: 20, value: growthScore(growth30?.salesGrowthRate ?? null), formula: 'clamp(50 + growthRate30d, 0, 100)' },
    { key: 'competition', label: 'Competition Gap', weight: 20, value: competitionScore, formula: '100 × (1 − topShopShare)' },
    { key: 'commercial', label: 'Commercial Potential', weight: 15, value: commercialScore, formula: 'log10(gmv+1)×15' },
    { key: 'creator', label: 'Creator Opportunity', weight: 10, value: creatorScore, formula: 'demand × (1 − min(1, creators/20))' },
    { key: 'stability', label: 'Market Stability', weight: 10, value: stability, formula: '100/(1+CV) daily increments ≥7' },
    { key: 'confidence', label: 'Data Confidence', weight: 5, value: null, formula: 'computed separately' },
  ];
  const scored = scoreOpportunity(inputs);

  const coveragePoints = coverage(
    [...salesByDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value, source: '', isEstimated: mode === 'SIMULATION', dataKind: (mode === 'SIMULATION' ? 'SIMULATED' : 'VERIFIED') as never })),
    90,
  ).points;

  const confidence = Math.round((scored.scoredCriteria.length / 6) * 100);

  const classification = classifyOpportunity({
    score: scored.total,
    confidence,
    isInsufficient: scored.isInsufficient,
    growthRate: growth30?.salesGrowthRate ?? null,
    competitionLevel: competitionLevel(topShopShare, shopCount),
    topShopShare,
  });
  out.push({
    key: String(scope.subCategoryId ?? scope.categoryId),
    categoryId: scope.categoryId,
    subCategoryId: scope.subCategoryId ?? null,
    name: scope.name,
    productCount: products.length,
    shopCount,
    creatorCount,
    totalSales,
    totalGmv,
    avgPrice: avgPrice !== null ? round2(avgPrice) : null,
    growth30d: growth30?.salesGrowthRate ?? null,
    growth7d: growth7?.salesGrowthRate ?? null,
    topShopShare: topShopShare !== null ? round2(topShopShare) : null,
    concentration: concentration !== null ? round2(concentration) : null,
    competitionLevel: competitionLevel(topShopShare, shopCount),
    opportunityScore: scored.isInsufficient ? null : scored.total,
    confidence,
    classification: classification.classification,
    scoredCriteria: scored.scoredCriteria,
    missing: scored.missing,
    coveragePoints,
    positiveFactors: classification.positiveFactors,
    negativeFactors: classification.negativeFactors,
    reasons: classification.reasons,
    limitation: mode === 'SIMULATION' ? 'SIMULATED — không phải dữ liệu thị trường thực.' : 'REAL_DATA — chỉ dùng dữ liệu đã xác minh.',
  });
}

function computeIncrements(byDay: Map<string, number>): number[] {
  const dates = [...byDay.keys()].sort();
  const increments: number[] = [];
  let prev: number | null = null;
  for (const date of dates) {
    const value = byDay.get(date)!;
    if (prev !== null) increments.push(Math.max(0, value - prev));
    prev = value;
  }
  return increments;
}
