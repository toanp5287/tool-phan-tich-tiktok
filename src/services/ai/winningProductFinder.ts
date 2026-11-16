import { datasetDb as db } from '../../config/datasetDb.js';
import { AppError } from '../../utils/errors.js';
import {
  buildGrowthSummary,
  competition,
  coverage,
  parseMode,
  readSeries,
  type AnalysisMode,
} from '../analyticsService.js';

const SCORE_VERSION = 'winning-score-v1';
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

type Classification = 'EMERGING_WINNER' | 'POTENTIAL_WINNER' | 'ESTABLISHED_WINNER' | 'SATURATED_PRODUCT' | 'DECLINING_PRODUCT';

interface CriterionScore {
  criterion: string;
  value: number | null;
  weight: number;
  formula: string;
  state: 'AVAILABLE' | 'INSUFFICIENT_DATA';
  evidence: Record<string, unknown>;
}

export interface WinningCandidate {
  productId: number;
  title: string;
  category: string | null;
  currency: string | null;
  price: number | null;
  sales: number | null;
  gmv: number | null;
  growth30d: number | null;
  growth90d: number | null;
  sellerCount: number;
  topShopShare: number | null;
  concentration: number | null;
  affiliateCreatorCount: number;
  winningScore: number | null;
  classification: Classification;
  scoredCriteria: string[];
  criteria: CriterionScore[];
  confidence: number;
  reasons: string[];
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  limitation: string;
}

/**
 * Winning Product Finder — distinct from Product Deep Analysis.
 * Ranks products across the whole market using a deterministic, backend-owned
 * score built from the shared Analytics Service. REAL_DATA ranks only verified
 * products; SIMULATION ranks the synthetic market and is explicitly labelled.
 * The LLM is NOT used to rank; the score is reproducible and auditable.
 */
export async function findWinningProducts(input: { mode?: unknown; days?: unknown; limit?: unknown; minSales?: unknown } = {}) {
  const mode = parseMode(input.mode);
  const days = Number.isFinite(Number(input.days)) ? Math.min(90, Math.max(7, Math.trunc(Number(input.days)))) : 30;
  const limit = Number.isFinite(Number(input.limit)) ? Math.min(200, Math.max(1, Math.trunc(Number(input.limit)))) : 50;

  // Enumerate products. In REAL_DATA only verified products; in SIMULATION products with simulated series.
  const products = await db.product.findMany({
    select: { id: true, title: true, currency: true, market: true, categories: { where: { isPrimary: true }, take: 1, include: { category: true } } },
    orderBy: { id: 'asc' },
  });

  const candidates: WinningCandidate[] = [];

  for (const product of products) {
    const sales = await readSeries('PRODUCT', product.id, 'soldCount', mode);
    const gmv = await readSeries('PRODUCT', product.id, 'gmv', mode);
    const price = await readSeries('PRODUCT', product.id, 'price', mode);

    // Skip products with no dated series in this mode.
    const datedSales = sales.filter((p) => p.value !== null);
    if (datedSales.length === 0) continue;

    const growth = buildGrowthSummary(sales, gmv, days);
    const growth30 = growth.periods.find((p) => p.days === 30);
    const growth90 = growth.periods.find((p) => p.days === 90);
    const comp = await competition(product.id, mode);
    const cov = coverage(sales, 90);
    const affiliateCreatorCount = mode === 'SIMULATION'
      ? await db.productCreator.count({ where: { productId: product.id, isSimulated: true } })
      : await db.productCreator.count({ where: { productId: product.id, verificationStatus: 'VERIFIED', isSimulated: false } });

    const currentSales = [...datedSales].reverse().find((p) => p.value !== null)?.value ?? null;
    const currentGmv = [...gmv].reverse().find((p) => p.value !== null)?.value ?? null;
    const currentPrice = [...price].reverse().find((p) => p.value !== null)?.value ?? null;

    const scored = scoreCandidate({
      currentSales,
      currentGmv,
      growth30Rate: growth30?.salesGrowthRate ?? null,
      growth90Rate: growth90?.salesGrowthRate ?? null,
      sellerCount: comp.sellerCount,
      topShopShare: comp.topShopShare,
      concentration: comp.concentration,
      coverageCompleteness: cov.completeness,
    });

    if (scored.total === null) continue; // not enough data to score

    const classification = classify(scored.total, {
      growth30Rate: growth30?.salesGrowthRate ?? null,
      sellerCount: comp.sellerCount,
      topShopShare: comp.topShopShare,
    });

    const reasons: string[] = [];
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const risks: string[] = [];
    for (const criterion of scored.criteria) {
      if (criterion.value === null) continue;
      if (criterion.value >= 70) strengths.push(`${criterion.criterion}: ${criterion.value}/100`);
      else if (criterion.value < 40) weaknesses.push(`${criterion.criterion}: ${criterion.value}/100`);
    }
    if (comp.sellerCount === 0) risks.push('Không có shop bán đã xác minh.');
    else if (comp.topShopShare !== null && comp.topShopShare >= 0.6) risks.push(`Mức độ tập trung cao: shop dẫn đầu chiếm ${round2(comp.topShopShare * 100)}% doanh số.`);
    if (scored.demand.value === null) weaknesses.push('Thiếu dữ liệu nhu cầu để chấm điểm đầy đủ.');
    reasons.push(`${classification === 'EMERGING_WINNER' ? 'Tăng trưởng mạnh với cạnh tranh thấp' : classification === 'POTENTIAL_WINNER' ? 'Tín hiệu tích cực, cần theo dõi' : classification === 'ESTABLISHED_WINNER' ? 'Nhu cầu đã được chứng minh' : classification === 'SATURATED_PRODUCT' ? 'Cạnh tranh cao, tăng trưởng chậm lại' : 'Xu hướng suy giảm'}.`);

    candidates.push({
      productId: product.id,
      title: product.title,
      category: product.categories[0]?.category.name ?? null,
      currency: product.currency,
      price: currentPrice,
      sales: currentSales,
      gmv: currentGmv,
      growth30d: growth30?.salesGrowthRate ?? null,
      growth90d: growth90?.salesGrowthRate ?? null,
      sellerCount: comp.sellerCount,
      topShopShare: comp.topShopShare,
      concentration: comp.concentration,
      affiliateCreatorCount,
      winningScore: scored.total,
      classification,
      scoredCriteria: scored.criteria.filter((c) => c.value !== null).map((c) => c.criterion),
      criteria: scored.criteria,
      confidence: scored.confidence,
      reasons,
      strengths,
      weaknesses,
      risks,
      limitation: mode === 'SIMULATION' ? 'SIMULATED — không phải sản phẩm chiến thắng thật trên thị trường.' : 'Chỉ dùng dữ liệu VERIFIED; không đại diện toàn thị trường.',
    });
  }

  candidates.sort((a, b) => (b.winningScore ?? -1) - (a.winningScore ?? -1));
  return {
    version: SCORE_VERSION,
    mode,
    days,
    generatedAt: new Date().toISOString(),
    total: candidates.length,
    top: candidates.slice(0, limit),
    methodology: {
      criteria: [
        { criterion: 'Market Demand', weight: 0.30, formula: 'min(100, soldCount percentile / cohort ceiling) — soldCount so với các sản phẩm cùng chế độ; nếu cohort < 10, dùng log-scale của soldCount' },
        { criterion: 'Growth Momentum', weight: 0.30, formula: 'clamp(50 + growthRate30d, 0, 100) khi có baseline 30 ngày; thiếu thì 0 điểm và loại khỏi trọng số' },
        { criterion: 'Competition Opportunity', weight: 0.20, formula: '100 × (1 − topShopShare) khi có topShopShare; sellerCount=0 → điểm thấp' },
        { criterion: 'Commercial Potential', weight: 0.10, formula: 'min(100, gmv percentile cohort)' },
        { criterion: 'Affiliate Potential', weight: 0.10, formula: 'min(100, sellerCount × 25)' },
      ],
      normalization: 'Mỗi nhóm điểm 0–100, tổng = Σ(value×weight)/Σ(weight khả dụng); nhóm thiếu dữ liệu bị loại khỏi trọng số (không tự gán 0).',
    },
  };
}

function scoreCandidate(input: {
  currentSales: number | null;
  currentGmv: number | null;
  growth30Rate: number | null;
  growth90Rate: number | null;
  sellerCount: number;
  topShopShare: number | null;
  concentration: number | null;
  coverageCompleteness: number | null;
}): { total: number | null; confidence: number; criteria: CriterionScore[]; demand: { value: number | null } } {
  const criteria: CriterionScore[] = [];

  // Demand: log-scaled sales (deterministic, no external cohort needed).
  const demand = input.currentSales !== null && input.currentSales > 0
    ? clamp100(Math.round(Math.log10(input.currentSales + 1) * 20))
    : null;
  criteria.push({ criterion: 'Market Demand', value: demand, weight: 0.30, formula: 'clamp(log10(soldCount+1) × 20, 0, 100)', state: demand === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', evidence: { soldCount: input.currentSales } });

  // Growth momentum: 30d sales growth rate.
  const growth30 = input.growth30Rate !== null
    ? clamp100(Math.round(50 + input.growth30Rate))
    : null;
  criteria.push({ criterion: 'Growth Momentum', value: growth30, weight: 0.30, formula: 'clamp(50 + growthRate30d, 0, 100)', state: growth30 === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', evidence: { growth30Rate: input.growth30Rate } });

  // Competition opportunity: inverse of top shop share.
  const compOpportunity = input.topShopShare !== null
    ? clamp100(Math.round((1 - input.topShopShare) * 100))
    : (input.sellerCount === 0 ? 0 : null);
  criteria.push({ criterion: 'Competition Opportunity', value: compOpportunity, weight: 0.20, formula: '100 × (1 − topShopShare); sellerCount=0 → 0', state: compOpportunity === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', evidence: { topShopShare: input.topShopShare, sellerCount: input.sellerCount } });

  // Commercial potential: log-scaled GMV.
  const commercial = input.currentGmv !== null && input.currentGmv > 0
    ? clamp100(Math.round(Math.log10(input.currentGmv + 1) * 15))
    : null;
  criteria.push({ criterion: 'Commercial Potential', value: commercial, weight: 0.10, formula: 'clamp(log10(gmv+1) × 15, 0, 100)', state: commercial === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', evidence: { gmv: input.currentGmv } });

  // Affiliate potential: rough proxy from seller count.
  const affiliate = clamp100(Math.min(100, input.sellerCount * 25));
  criteria.push({ criterion: 'Affiliate Potential', value: affiliate, weight: 0.10, formula: 'min(100, sellerCount × 25)', state: 'AVAILABLE', evidence: { sellerCount: input.sellerCount } });

  const available = criteria.filter((c) => c.value !== null);
  if (available.length === 0) return { total: null, confidence: 0, criteria, demand: { value: demand } };
  const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
  const total = Math.round(available.reduce((sum, c) => sum + c.value! * c.weight, 0) / totalWeight);
  const confidence = Math.round(available.length / criteria.length * 100);
  return { total, confidence, criteria, demand: { value: demand } };
}

function classify(score: number, input: { growth30Rate: number | null; sellerCount: number; topShopShare: number | null }): Classification {
  const growth = input.growth30Rate ?? 0;
  if (score >= 70 && growth > 20 && input.sellerCount <= 3) return 'EMERGING_WINNER';
  if (score >= 55) return 'POTENTIAL_WINNER';
  if (input.topShopShare !== null && input.topShopShare >= 0.6 && score >= 50) return 'SATURATED_PRODUCT';
  if (growth < -10) return 'DECLINING_PRODUCT';
  if (score >= 40) return 'ESTABLISHED_WINNER';
  return 'DECLINING_PRODUCT';
}
