import { createHash } from 'node:crypto';
import type { Prisma } from '../../../generated/v2/index.js';
import { datasetDay } from '../analytics.js';
import { datasetDb as db } from '../../config/datasetDb.js';
import { AppError } from '../../utils/errors.js';
import { categoryDisplayName, subCategoryDisplayName } from '../../config/taxonomyDisplayNames.js';
import { percentile, scoreMarketGap, stabilityFromIncrements } from './opportunityScoring.js';
import type { ChartSpec, Evidence, EvidencePack, MarketGapAnalysisRequest, MarketGapCompetition, MarketGapConfidencePart, MarketGapDemand, MarketGapEmptyReason, MarketGapMetric, MarketGapNiche, MarketGapNicheDetail, MarketGapResult, NicheStatus, NicheTopProduct, NicheTopShop, Score, State } from './marketIntelligenceTypes.js';

const VERSION = 'market-gap-v1';
const SCORE_VERSION = 'mi-score-v4';
const TTL_MS = 30 * 60 * 1000;
const AI_MIN_CONFIDENCE = 60;
const COVERAGE_THRESHOLD = 0.6;
const COHORT_MIN = 10;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const number = (value: unknown): number | null => { const result = Number(value); return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : null; };
const sourceInclude = { record: { include: { file: { include: { source: true } } } } };

export function parseMarketGapRequest(input: unknown): MarketGapAnalysisRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw AppError.badRequest('Body phải là object');
  const value = input as Record<string, unknown>;
  const categoryId = Number(value.categoryId), subCategoryId = value.subCategoryId === undefined || value.subCategoryId === null || value.subCategoryId === '' ? undefined : Number(value.subCategoryId);
  const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : '';
  const days = Number(value.days ?? 30), mode = value.mode ?? 'QUICK', market = value.market ?? 'VN';
  if (market !== 'VN' || !Number.isSafeInteger(categoryId) || categoryId <= 0 || subCategoryId !== undefined && (!Number.isSafeInteger(subCategoryId) || subCategoryId <= 0) || !currency || currency.length > 12 || ![7, 30, 90].includes(days) || !['QUICK', 'DEEP'].includes(String(mode)) || value.force !== undefined && typeof value.force !== 'boolean') throw AppError.badRequest('Phạm vi Tìm khoảng trống thị trường không hợp lệ');
  return { market: 'VN', categoryId, subCategoryId, currency, days: days as 7 | 30 | 90, mode: mode as 'QUICK' | 'DEEP', force: value.force === true };
}

type Observation = { id: bigint; rawRecordId: bigint; observedAt: Date | null; importedAt: Date; soldCount: bigint | null; price: unknown; currency: string | null; record: { file: { sha256: string; source: { code: string; usageRestriction: string } } } };

interface ProductScope {
  id: number;
  title: string;
  imageUrl: string | null;
  shops: { shopId: number; shop: { name: string } }[];
  observations: Observation[];
}

async function loadScopeProducts(categoryId: number, subCategoryId: number | undefined, currency: string, market: string, take: number): Promise<ProductScope[]> {
  const where: Prisma.ProductWhereInput = {
    market, currency,
    categories: { some: { categoryId, ...(subCategoryId ? { subCategoryId } : {}), isPrimary: true, verificationStatus: 'VERIFIED' } },
  };
  return db.product.findMany({
    where, orderBy: { id: 'asc' }, take,
    include: {
      shops: { where: { isActive: true, verificationStatus: 'VERIFIED' }, select: { shopId: true, shop: { select: { name: true } } } },
      observations: { orderBy: [{ observedAt: 'asc' }, { importedAt: 'asc' }, { id: 'asc' }], select: { id: true, rawRecordId: true, observedAt: true, importedAt: true, soldCount: true, price: true, currency: true, record: { select: { file: { select: { sha256: true, source: { select: { code: true, usageRestriction: true } } } } } } } },
    },
  });
}

function productWhere(categoryId: number, subCategoryId: number | undefined, currency: string, market: string): Prisma.ProductWhereInput {
  return { market, currency, categories: { some: { categoryId, ...(subCategoryId ? { subCategoryId } : {}), isPrimary: true, verificationStatus: 'VERIFIED' } } };
}

async function scopeWatermark(request: MarketGapAnalysisRequest) {
  const latest = await db.productObservation.findFirst({ where: { product: productWhere(request.categoryId, request.subCategoryId, request.currency, request.market) }, orderBy: { importedAt: 'desc' }, select: { importedAt: true } });
  return latest?.importedAt ?? null;
}

function observationEvidence(evidence: Evidence[], productId: number, metric: string, value: number | null, observation: Observation | undefined, unit: string, notes: string[] = []): Evidence {
  const id = 'ev-' + hash([productId, metric, observation?.id.toString() ?? '', value]).slice(0, 20);
  const row: Evidence = { id, entityId: 'PRODUCT:' + productId, entityType: 'PRODUCT', metric, value, unit, currency: null, dataKind: value === null ? 'UNKNOWN' : 'VERIFIED', state: value === null ? 'NO_DATA' : observation?.observedAt ? 'OK' : 'NO_TIMESTAMP', observedAt: observation?.observedAt?.toISOString() ?? null, source: observation?.record.file.source.code ?? null, usageRestriction: observation?.record.file.source.usageRestriction ?? 'UNKNOWN', recordIds: observation ? [observation.rawRecordId.toString()] : [], fileHashes: observation ? [observation.record.file.sha256] : [], formula: null, inputIds: [], limitations: notes };
  if (!evidence.some(item => item.id === id)) evidence.push(row);
  return row;
}

function derivedEvidence(evidence: Evidence[], entityId: string, metric: string, value: number | null, unit: string, formula: string, inputIds: string[], notes: string[] = []): Evidence {
  const inputs = evidence.filter(item => inputIds.includes(item.id));
  const id = 'ev-' + hash([entityId, metric, value, formula, inputIds]).slice(0, 20);
  const row: Evidence = { id, entityId, entityType: 'CATEGORY', metric, value, unit, currency: null, dataKind: value === null ? 'UNKNOWN' : 'ESTIMATED', state: value === null ? 'NO_DATA' : 'OK', observedAt: inputs.map(item => item.observedAt).filter((date): date is string => !!date).sort().at(-1) ?? null, source: [...new Set(inputs.map(item => item.source).filter(Boolean))].join(',') || null, usageRestriction: 'UNKNOWN', recordIds: [...new Set(inputs.flatMap(item => item.recordIds))], fileHashes: [...new Set(inputs.flatMap(item => item.fileHashes))], formula: value === null ? null : formula, inputIds, limitations: notes };
  if (!evidence.some(item => item.id === id)) evidence.push(row);
  return row;
}

function inPeriod(start: Date, end: Date, day: string): boolean { const time = Date.parse(day + 'T00:00:00Z'); return time >= start.getTime() && time <= end.getTime(); }

interface NicheComputation {
  evidence: Evidence[];
  demand: MarketGapDemand;
  competition: MarketGapCompetition;
  scores: Score[];
  confidence: number;
  confidenceBreakdown: MarketGapConfidencePart[];
  missing: string[];
  allIncrements: number[];
  topProducts: NicheTopProduct[];
  topShops: NicheTopShop[];
  history: ChartSpec[];
  products: ProductScope[];
  metrics: MarketGapNiche['metrics'];
  analysisLevel: MarketGapNiche['analysisLevel'];
  opportunityScoreKind: MarketGapNiche['opportunityScoreKind'];
  scoredCriteria: string[];
}

function computeNiche(products: ProductScope[], currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date): NicheComputation {
  const evidence: Evidence[] = [];
  const allIncrements: number[] = [];
  let historyProducts = 0, activeProducts = 0, currentTotal = 0, previousTotal = 0, currentPointProducts = 0, previousPointProducts = 0, linkedProducts = 0, productsWithSold = 0;
  const currentEvidenceIds: string[] = [], previousEvidenceIds: string[] = [];
  const productSales: { id: number; title: string; imageUrl: string | null; price: number | null; soldCount: number | null; estimated: number | null }[] = [];
  const shopSales = new Map<number, { id: number; name: string; productCount: number; estimated: number }>();

  for (const product of products) {
    if (product.shops.length) linkedProducts++;
    const latest = [...product.observations].reverse().find(observation => number(observation.soldCount) !== null || number(observation.price) !== null);
    const latestSold = number(latest?.soldCount);
    const latestPrice = latest?.currency === null || latest?.currency === undefined || latest.currency === 'VND' ? number(latest?.price) : null;
    const soldEvidence = observationEvidence(evidence, product.id, 'soldCount', latestSold, latest, 'lượt bán tích lũy');
    const priceEvidence = observationEvidence(evidence, product.id, 'price', latestPrice, latest, 'VND', latest?.currency && latest.currency !== 'VND' ? ['Đơn vị tiền tệ quan sát không khớp phạm vi phân tích.'] : []);
    if (latestSold !== null) productsWithSold++;
    const daily = new Map<string, Observation>();
    for (const observation of product.observations) if (observation.observedAt && number(observation.soldCount) !== null) daily.set(datasetDay(observation.observedAt), observation);
    const rows = [...daily.entries()].sort(([a], [b]) => a.localeCompare(b));
    let previousSold: number | null = null, currentPoints = 0, previousPoints = 0, current = 0, prior = 0;
    for (const [day, observation] of rows) {
      const sold = number(observation.soldCount); const price = number(observation.price);
      if (sold === null) continue;
      const source = observationEvidence(evidence, product.id, 'soldCountHistory', sold, observation, 'lượt bán tích lũy');
      if (inPeriod(currentStart, currentEnd, day)) currentPoints++; if (inPeriod(previousStart, previousEnd, day)) previousPoints++;
      if (previousSold !== null) {
        const increment = Math.max(0, sold - previousSold);
        const reset = sold < previousSold;
        const incrementEvidence = derivedEvidence(evidence, 'PRODUCT:' + product.id, 'dailySalesIncrement', increment, 'đơn vị', 'max(0, lượt bán tích lũy hiện tại - lượt bán tích lũy mốc trước)', [source.id], reset ? ['Chênh lệch tích lũy âm được coi là điều chỉnh và giữ ở 0'] : []);
        if (inPeriod(currentStart, currentEnd, day)) { current += increment; currentEvidenceIds.push(incrementEvidence.id); if (increment > 0) allIncrements.push(increment); }
        if (inPeriod(previousStart, previousEnd, day)) { prior += increment; previousEvidenceIds.push(incrementEvidence.id); }
      }
      previousSold = sold;
    }
    if (currentPoints >= 2) { historyProducts++; currentTotal += current; if (current > 0) activeProducts++; }
    if (previousPoints >= 2) { previousPointProducts++; previousTotal += prior; }
    if (currentPoints >= 2) currentPointProducts++;
    const estimated = latestSold !== null && latestPrice !== null && latestSold >= 0 && latestPrice > 0 ? latestSold * latestPrice : null;
    if (estimated !== null) derivedEvidence(evidence, 'PRODUCT:' + product.id, 'estimatedSalesValue', estimated, 'VND', 'lượt bán tích lũy × giá quan sát gần nhất', [soldEvidence.id, priceEvidence.id], ['Giá trị bán là ước tính theo giá hiện tại, không phải doanh thu thực tế']);
    productSales.push({ id: product.id, title: product.title, imageUrl: product.imageUrl, price: latestPrice, soldCount: latestSold, estimated });
    for (const link of product.shops) {
      const existing = shopSales.get(link.shopId);
      if (existing) { existing.productCount++; if (estimated !== null) existing.estimated += estimated; }
      else shopSales.set(link.shopId, { id: link.shopId, name: link.shop.name, productCount: 1, estimated: estimated ?? 0 });
    }
  }

  const enoughHistory = currentPointProducts > 0 && previousPointProducts > 0;
  const growthRate = enoughHistory && previousTotal > 0 ? (currentTotal - previousTotal) * 100 / previousTotal : null;
  const productCoverage = products.length ? productsWithSold / products.length : null;
  const estimatedValues = productSales.map(p => p.estimated).filter((value): value is number => value !== null);
  const estimatedSalesValue = estimatedValues.length ? estimatedValues.reduce((sum, value) => sum + value, 0) : null;

  const shopIds = new Set(products.flatMap(product => product.shops.map(link => link.shopId)));
  const shopCount = products.length ? shopIds.size : null;
  const density = shopCount !== null && productsWithSold > 0 ? shopCount / productsWithSold : null;
  const coverage = products.length ? linkedProducts / products.length : null;

  const topShopValue = [...shopSales.values()].sort((a, b) => b.estimated - a.estimated)[0]?.estimated ?? 0;
  const totalShopValue = [...shopSales.values()].reduce((sum, s) => sum + s.estimated, 0);
  const topShopValueShare = totalShopValue > 0 ? topShopValue / totalShopValue : null;

  const currentEvidence = derivedEvidence(evidence, 'CATEGORY', 'currentPeriodSalesIncrement', currentPointProducts ? currentTotal : null, 'đơn vị', 'tổng mức tăng lượt bán theo ngày của từng sản phẩm trong kỳ hiện tại', currentEvidenceIds, ['Lượt bán tích lũy chỉ được quy đổi qua mức tăng dương theo ngày']);
  const previousEvidence = derivedEvidence(evidence, 'CATEGORY', 'previousPeriodSalesIncrement', previousPointProducts ? previousTotal : null, 'đơn vị', 'tổng mức tăng lượt bán theo ngày của từng sản phẩm trong kỳ trước', previousEvidenceIds, ['Lượt bán tích lũy chỉ được quy đổi qua mức tăng dương theo ngày']);
  const growthEvidence = derivedEvidence(evidence, 'CATEGORY', 'demandGrowthRate', growthRate, '%', '100 × (tăng kỳ hiện tại - tăng kỳ trước) / tăng kỳ trước', [currentEvidence.id, previousEvidence.id], ['Cần ít nhất hai mốc quan sát mỗi kỳ và kỳ trước > 0']);
  const salesValueEvidence = derivedEvidence(evidence, 'CATEGORY', 'estimatedSalesValue', estimatedSalesValue, 'VND', 'tổng (lượt bán tích lũy × giá quan sát gần nhất) các sản phẩm có dữ liệu', evidence.filter(item => item.metric === 'estimatedSalesValue' && item.entityType === 'PRODUCT').map(item => item.id), ['Giá trị bán là ước tính theo giá hiện tại, không phải doanh thu thực tế']);
  const shopEvidence = derivedEvidence(evidence, 'CATEGORY', 'observedVerifiedActiveShopCount', shopCount, 'shop', 'đếm số shop liên kết ProductShop đang hoạt động và đã xác minh', [], ['Đây là số shop quan sát được trong dataset, không phải tổng đối thủ toàn thị trường']);
  const topShareEvidence = derivedEvidence(evidence, 'CATEGORY', 'topShopValueShare', topShopValueShare, 'tỷ lệ', 'giá trị bán của shop lớn nhất / tổng giá trị bán của các shop', [salesValueEvidence.id], ['Phân bố trong mẫu quan sát, không đại diện toàn thị trường']);

  const stability = stabilityFromIncrements(allIncrements);
  const competitionAdvantage = coverage !== null && coverage >= COVERAGE_THRESHOLD && topShopValueShare !== null ? 100 * (1 - topShopValueShare) : null;

  const rawScore = scoreMarketGap({ demandLevel: null, growthRate, competitionAdvantage, stability, productCoverage });
  const scoreEvidenceIds = [currentEvidence.id, previousEvidence.id, growthEvidence.id, shopEvidence.id, topShareEvidence.id, salesValueEvidence.id];
  const scores: Score[] = rawScore.scores.map(score => ({ ...score, evidenceIds: scoreEvidenceIds }));

  const provenance = evidence.filter(item => item.recordIds.length && item.source).length;
  const verifiedLinks = products.filter(product => product.shops.length > 0).length;
  const freshImport = products.flatMap(product => product.observations.map(observation => observation.importedAt.toISOString())).sort().at(-1) ?? null;
  const stale = !freshImport || Date.now() - Date.parse(freshImport) > 30 * 86400000;

  const confidenceBreakdown: MarketGapConfidencePart[] = [
    { criterion: 'Sản phẩm có bằng chứng cốt lõi', points: productsWithSold ? 25 : 0, maxPoints: 25, state: productsWithSold ? 'AVAILABLE' : 'INSUFFICIENT_DATA', formula: '25 điểm khi có ít nhất một sản phẩm có lượt bán quan sát hợp lệ', evidenceIds: evidence.filter(item => item.metric === 'soldCount').map(item => item.id) },
    { criterion: 'Độ phủ timestamp lịch sử', points: Math.min(25, Math.round(25 * Math.min(currentPointProducts, previousPointProducts) / 10)), maxPoints: 25, state: currentPointProducts && previousPointProducts ? 'OK' : 'INSUFFICIENT_HISTORY', formula: '25 × min(sản phẩm có 2 mốc quan sát mỗi kỳ, 10) / 10', evidenceIds: [currentEvidence.id, previousEvidence.id] },
    { criterion: 'Xuất xứ bằng chứng', points: evidence.length ? Math.round(20 * provenance / evidence.length) : 0, maxPoints: 20, state: provenance ? 'OK' : 'NO_DATA', formula: '20 × bằng chứng có nguồn và raw record / tổng bằng chứng', evidenceIds: evidence.slice(0, 20).map(item => item.id) },
    { criterion: 'Độ phủ quan hệ đã xác minh', points: products.length ? Math.round(10 * verifiedLinks / products.length) : 0, maxPoints: 10, state: verifiedLinks ? 'OK' : 'NO_DATA', formula: '10 × sản phẩm có liên kết shop đã xác minh / tổng sản phẩm', evidenceIds: [shopEvidence.id] },
    { criterion: 'Tính mới của dữ liệu nhập', points: stale ? 0 : 10, maxPoints: 10, state: stale ? 'STALE_DATA' : 'AVAILABLE', formula: '10 điểm khi bản ghi được nhập gần nhất không quá 30 ngày; không thay thế timestamp quan sát', evidenceIds: evidence.slice(0, 20).map(item => item.id) },
  ];
  const confidence = confidenceBreakdown.reduce((sum, item) => sum + item.points, 0);
  const metrics: MarketGapNiche['metrics'] = {
    demand: { value: productsWithSold || null, state: productsWithSold ? 'AVAILABLE' : 'INSUFFICIENT_DATA', reason: productsWithSold ? null : 'Chưa có lượt bán quan sát hợp lệ.', evidenceIds: evidence.filter(item => item.metric === 'soldCount').map(item => item.id) },
    estimatedSalesValue: { value: estimatedSalesValue, state: estimatedSalesValue === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', reason: estimatedSalesValue === null ? 'Cần đồng thời có giá và lượt bán hợp lệ cùng đơn vị tiền tệ.' : null, evidenceIds: [salesValueEvidence.id] },
    growth: { value: growthRate, state: growthRate === null ? 'INSUFFICIENT_HISTORY' : 'AVAILABLE', reason: growthRate === null ? 'Cần ít nhất hai mốc lượt bán có timestamp ở mỗi kỳ và kỳ trước lớn hơn 0.' : null, evidenceIds: [growthEvidence.id] },
    competition: { value: competitionAdvantage, state: competitionAdvantage === null ? (shopCount === null ? 'INSUFFICIENT_DATA' : 'NOT_APPLICABLE') : 'AVAILABLE', reason: competitionAdvantage === null ? 'Cần độ phủ liên kết shop đã xác minh từ 60% và giá trị bán ước tính theo shop.' : null, evidenceIds: [shopEvidence.id, topShareEvidence.id] },
    stability: { value: stability, state: stability === null ? 'INSUFFICIENT_HISTORY' : 'AVAILABLE', reason: stability === null ? 'Cần ít nhất 7 mức tăng lượt bán hợp lệ theo ngày.' : null, evidenceIds: currentEvidenceIds },
    productCoverage: { value: productCoverage, state: productCoverage === null ? 'INSUFFICIENT_DATA' : 'AVAILABLE', reason: productCoverage === null ? 'Chưa có sản phẩm thuộc ngách.' : null, evidenceIds: evidence.filter(item => item.metric === 'soldCount').map(item => item.id) },
  };
  const missing = Object.entries(metrics).filter(([, metric]) => metric.state !== 'AVAILABLE').map(([name, metric]) => metric.reason ?? name);

  const topProducts: NicheTopProduct[] = productSales.filter(p => p.price !== null || p.soldCount !== null).sort((a, b) => (b.estimated ?? -1) - (a.estimated ?? -1)).slice(0, 10).map(p => ({ id: p.id, title: p.title, imageUrl: p.imageUrl, price: p.price, soldCount: p.soldCount, estimatedSalesValue: p.estimated }));
  const topShops: NicheTopShop[] = [...shopSales.values()].sort((a, b) => b.estimated - a.estimated).slice(0, 10).map(s => ({ id: s.id, name: s.name, productCount: s.productCount, estimatedSalesValue: s.estimated }));

  const history: ChartSpec[] = enoughHistory ? [{ id: 'niche-demand', type: 'bar', title: 'Lượt bán tăng thêm theo kỳ', unit: 'đơn vị', period: `${previousStart.toISOString().slice(0, 10)} → ${currentEnd.toISOString().slice(0, 10)}`, dataKind: 'ESTIMATED', state: 'OK', labels: ['Kỳ trước', 'Kỳ hiện tại'], values: [previousEvidence.value, currentEvidence.value], evidenceIds: [previousEvidence.id, currentEvidence.id] }] : [];
  const analysisLevel = enoughHistory && rawScore.isFull ? 'FULL' : shopCount !== null ? 'EXTENDED' : 'PRELIMINARY';

  return {
    evidence, demand: { estimatedSalesValue, currentPeriodSalesIncrement: currentEvidence.value, previousPeriodSalesIncrement: previousEvidence.value, growthRate, activeProductCount: historyProducts ? activeProducts : null, validProductCount: productsWithSold, productCoverage },
    competition: { observedVerifiedActiveShopCount: shopCount, observedShopDensity: density, linkedProductCoverage: coverage, topShopValueShare: topShopValueShare },
    scores, confidence, confidenceBreakdown, missing, allIncrements, topProducts, topShops, history, products, metrics, analysisLevel, opportunityScoreKind: rawScore.total === null ? null : rawScore.isFull ? 'FULL' : 'PRELIMINARY', scoredCriteria: rawScore.scoredCriteria,
  };
}

function classifyNiche(score: number | null, confidence: number, competition: MarketGapCompetition, missing: string[]): { status: NicheStatus; reasons: string[] } {
  const hasHighCompetition = competition.topShopValueShare !== null && competition.topShopValueShare >= 0.6 && confidence >= 65;
  if (score === null) return { status: 'INSUFFICIENT_DATA', reasons: ['Chưa có thành phần điểm cơ hội đủ điều kiện.', ...missing] };
  if (hasHighCompetition) return { status: 'HIGH_COMPETITION', reasons: ['Có bằng chứng cạnh tranh cao và dữ liệu đủ tin cậy'] };
  if (!missing.length && score >= 80 && confidence >= 80) return { status: 'HIGH_POTENTIAL', reasons: ['Điểm cơ hội đầy đủ và độ tin cậy đều ở ngưỡng cao'] };
  if (!missing.length && score >= 65 && confidence >= 65) return { status: 'POSITIVE_SIGNAL', reasons: ['Điểm cơ hội đầy đủ và độ tin cậy cho thấy tín hiệu tích cực'] };
  return { status: 'WATCH', reasons: ['Điểm cơ hội sơ bộ chỉ dùng các thành phần có bằng chứng.', ...missing] };
}

function makeEvidencePack(request: MarketGapAnalysisRequest, niches: MarketGapNiche[], asOf: string | null, stale: boolean): EvidencePack {
  const pack: EvidencePack = {
    version: 'mi-evidence-v1', scoringVersion: SCORE_VERSION, reportVersion: 'mi-report-v1', fingerprint: '',
    request: { entityType: 'CATEGORY', entityId: String(request.categoryId), module: 'OPPORTUNITY_DISCOVERY', mode: request.mode === 'DEEP' ? 'DEEP' : 'OPPORTUNITY', audience: 'SELLER', days: request.days, compareIds: [] },
    entity: { id: String(request.subCategoryId ?? request.categoryId), type: 'CATEGORY', name: 'Tìm khoảng trống thị trường' },
    scope: 'Tìm khoảng trống thị trường · danh mục/danh mục con · đơn vị tiền tệ riêng', asOf, preparedAt: new Date().toISOString(), stale,
    evidence: [], history: {}, relations: [], charts: [], scores: [], opportunityScore: null, evidenceConfidence: 0, candidates: [], missing: [],
    limitations: ['Số shop quan sát được là cận dưới của dataset, không phải tổng đối thủ toàn thị trường', 'Lượt bán tích lũy chỉ được dùng qua mức tăng dương theo ngày', 'Giá trị bán là ước tính theo giá hiện tại, không phải doanh thu thực tế', 'Không có dữ liệu biên lợi nhuận, chi phí, hoàn hàng hay doanh thu theo shop'],
    sourcePolicy: { canSendToProvider: true, blockedSources: [] },
    sample: { selected: niches.length, available: niches.length, truncated: false },
  };
  pack.fingerprint = hash({ ...pack, preparedAt: undefined, fingerprint: undefined, nicheStates: niches.map(niche => ({ key: niche.key, score: niche.opportunityScore, confidence: niche.evidenceConfidence, reasons: niche.statusReasons })) });
  return pack;
}

export async function buildMarketGapResult(request: MarketGapAnalysisRequest): Promise<MarketGapResult> {
  const category = await db.category.findUnique({ where: { id: request.categoryId }, select: { id: true, name: true, slug: true } });
  if (!category) throw AppError.notFound('Không tìm thấy danh mục');
  const subCategories = await db.subCategory.findMany({ where: { categoryId: request.categoryId }, orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } });

  const now = new Date();
  const currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const currentStart = new Date(currentEnd.getTime() - (request.days - 1) * 86400000);
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - (request.days - 1) * 86400000);
  const take = request.mode === 'DEEP' ? 500 : 200;
  const start = new Date(previousStart.getTime() - 86400000);
  const categoryFilter: Prisma.ProductWhereInput = { categories: { some: { categoryId: request.categoryId, ...(request.subCategoryId ? { subCategoryId: request.subCategoryId } : {}), isPrimary: true, verificationStatus: 'VERIFIED' } } };
  const [allScopeProducts, vnScopeProducts, requestedCurrencyProducts, salesProducts, recentSalesProducts] = await Promise.all([
    db.product.count({ where: categoryFilter }),
    db.product.count({ where: { ...categoryFilter, market: request.market } }),
    db.product.count({ where: { ...categoryFilter, market: request.market, currency: request.currency } }),
    db.product.count({ where: { ...categoryFilter, market: request.market, currency: request.currency, observations: { some: { soldCount: { not: null } } } } }),
    db.product.count({ where: { ...categoryFilter, market: request.market, currency: request.currency, observations: { some: { soldCount: { not: null }, observedAt: { gte: start, not: null } } } } }),
  ]);

  // Xác định danh sách subcategory cần phân tích.
  const targetSubIds: (number | undefined)[] = request.subCategoryId !== undefined ? [request.subCategoryId] : (subCategories.length ? subCategories.map(s => s.id) : [undefined]);

  const niches: MarketGapNiche[] = [];
  for (const subId of targetSubIds) {
    const subCategory = subId === undefined ? null : subCategories.find(s => s.id === subId) ?? null;
    const products = await loadScopeProducts(request.categoryId, subId, request.currency, request.market, take);
    if (products.length === 0) continue;
    const computed = computeNiche(products, currentStart, currentEnd, previousStart, previousEnd);

    const subFilter: Prisma.ProductWhereInput = { categories: { some: { categoryId: request.categoryId, ...(subId ? { subCategoryId: subId } : {}), isPrimary: true, verificationStatus: 'VERIFIED' } } };
    const [subAll, subVn, subCurrency, subSold] = await Promise.all([
      db.product.count({ where: subFilter }),
      db.product.count({ where: { ...subFilter, market: request.market } }),
      db.product.count({ where: { ...subFilter, market: request.market, currency: request.currency } }),
      db.product.count({ where: { ...subFilter, market: request.market, currency: request.currency, observations: { some: { soldCount: { not: null } } } } }),
    ]);
    const inventoryReasons: string[] = [];
    if (subAll === 0) inventoryReasons.push('Không có sản phẩm thuộc ngách này.');
    else if (subVn === 0 || subCurrency === 0) inventoryReasons.push(`Không có sản phẩm thị trường Việt Nam sử dụng ${request.currency}.`);
    else if (subSold === 0) inventoryReasons.push('Có sản phẩm phù hợp nhưng chưa có dữ liệu lượt bán hợp lệ.');

    const missing = [...new Set([...inventoryReasons, ...computed.missing])];
    const preliminary = scoreMarketGap({ demandLevel: null, growthRate: computed.demand.growthRate, competitionAdvantage: computed.metrics.competition.value, stability: computed.metrics.stability.value, productCoverage: computed.demand.productCoverage });
    const { status, reasons } = classifyNiche(preliminary.total, computed.confidence, computed.competition, missing);

    niches.push({
      key: String(subId ?? category.id),
      subCategory: subCategory ? { id: subCategory.id, name: subCategoryDisplayName(subCategory.name, subCategory.slug), sourceName: subCategory.name } : null,
      status, statusReasons: reasons,
      marketDemand: computed.demand, marketCompetition: computed.competition,
      analysisLevel: computed.analysisLevel, productCount: products.length, metrics: computed.metrics,
      opportunityScore: preliminary.total, opportunityScoreKind: preliminary.total === null ? null : preliminary.isFull ? 'FULL' : 'PRELIMINARY', scoredCriteria: preliminary.scoredCriteria,
      evidenceConfidence: computed.confidence, confidenceBreakdown: computed.confidenceBreakdown,
      scores: preliminary.scores.map(score => ({ ...score, evidenceIds: computed.evidence.map(item => item.id) })), missingRequiredMetrics: missing, limitations: missing,
    });
  }

  // Tính percentile nhu cầu dựa trên giá trị bán ước tính giữa các ngách (cùng category + currency).
  const salesValues = niches.map(n => n.marketDemand.estimatedSalesValue).filter((v): v is number => v !== null);
  if (salesValues.length >= COHORT_MIN) {
    for (const niche of niches) {
      const value = niche.marketDemand.estimatedSalesValue;
      if (value === null) continue;
      const level = percentile(value, salesValues);
      if (level === null) continue;
      // Thay thế thành phần "Nhu cầu thị trường" (đã null) bằng giá trị percentile thực.
      const demandScore = niche.scores.find(s => s.criterion === 'Nhu cầu thị trường');
      if (demandScore) { demandScore.value = level; demandScore.state = 'AVAILABLE'; }
      const missing = niche.missingRequiredMetrics.filter(m => m !== 'Nhu cầu thị trường');
      niche.missingRequiredMetrics = missing;
      // Recompute score & classification after demand level is available.
      const rescored = scoreMarketGap({ demandLevel: level, growthRate: niche.marketDemand.growthRate, competitionAdvantage: niche.metrics.competition.value, stability: niche.metrics.stability.value, productCoverage: niche.marketDemand.productCoverage });
      niche.scores = rescored.scores;
      niche.opportunityScore = rescored.total;
      niche.opportunityScoreKind = rescored.total === null ? null : rescored.isFull ? 'FULL' : 'PRELIMINARY';
      niche.scoredCriteria = rescored.scoredCriteria;
      if (rescored.isFull) niche.analysisLevel = 'FULL';
      const cls = classifyNiche(niche.opportunityScore, niche.evidenceConfidence, niche.marketCompetition, niche.missingRequiredMetrics);
      niche.status = cls.status; niche.statusReasons = cls.reasons;
    }
  }

  let emptyReason: MarketGapEmptyReason | null = null;
  let emptyMessage: string | null = null;
  if (niches.length === 0) {
    if (allScopeProducts === 0) { emptyReason = 'NO_PRODUCTS'; emptyMessage = 'Không có sản phẩm thuộc danh mục đã chọn.'; }
    else if (vnScopeProducts === 0 || requestedCurrencyProducts === 0) { emptyReason = 'NO_REQUESTED_CURRENCY_PRODUCTS'; emptyMessage = `Không có sản phẩm thị trường Việt Nam sử dụng ${request.currency} trong danh mục đã chọn.`; }
    else if (salesProducts === 0) { emptyReason = 'NO_SALES_DATA'; emptyMessage = 'Có sản phẩm phù hợp nhưng chưa có dữ liệu lượt bán hợp lệ.'; }
    else { emptyReason = 'NO_ELIGIBLE_NICHES'; emptyMessage = 'Có dữ liệu nhưng chưa có ngách nào đủ điều kiện hiển thị.'; }
  }
  const cacheEligible = !emptyReason;
  const pack = makeEvidencePack(request, niches, null, niches.length === 0);

  return {
    version: VERSION, scoringVersion: SCORE_VERSION,
    request: { market: 'VN', categoryId: request.categoryId, ...(request.subCategoryId ? { subCategoryId: request.subCategoryId } : {}), currency: request.currency, days: request.days, mode: request.mode },
    scope: { market: 'VN', category: { id: category.id, name: categoryDisplayName(category.name, category.slug), sourceName: category.name }, subCategory: request.subCategoryId ? (() => { const sub = subCategories.find(s => s.id === request.subCategoryId); return sub ? { id: sub.id, name: subCategoryDisplayName(sub.name, sub.slug), sourceName: sub.name } : null; })() : null, currency: request.currency, days: request.days },
    asOf: null, stale: niches.length === 0, niches, nicheCount: niches.length,
    diagnostics: { emptyReason, message: emptyMessage, cacheEligible },
    aiEligibility: { eligible: niches.some(niche => niche.productCount > 0), reason: niches.some(niche => niche.productCount > 0) ? null : 'Chưa có ngách nào có sản phẩm thực tế để tạo Evidence Pack.', minimumConfidence: AI_MIN_CONFIDENCE },
    evidencePack: pack,
  };
}

export async function getOrCreateMarketGapAnalysis(request: MarketGapAnalysisRequest) {
  const watermark = await scopeWatermark(request);
  const cacheEligible = watermark !== null;
  if (!request.force && cacheEligible) {
    const cached = await db.marketGapAnalysis.findFirst({ where: { market: request.market, categoryId: request.categoryId, subCategoryId: request.subCategoryId ?? null, currency: request.currency, days: request.days, mode: request.mode, scoringVersion: SCORE_VERSION, dataWatermark: watermark, status: 'COMPLETED', expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' } });
    if (cached) return { analysisId: cached.id.toString(), cacheHit: true, persisted: true, result: cached.result as unknown as MarketGapResult };
  }
  const result = await buildMarketGapResult(request);
  if (!result.diagnostics.cacheEligible) return { analysisId: null, cacheHit: false, persisted: false, result };
  const fingerprint = result.evidencePack.fingerprint;
  const expiresAt = new Date(Date.now() + TTL_MS);
  const data = { market: request.market, categoryId: request.categoryId, subCategoryId: request.subCategoryId ?? null, currency: request.currency, days: request.days, mode: request.mode, scoringVersion: SCORE_VERSION, fingerprint, dataWatermark: watermark, status: 'COMPLETED', result: result as unknown as Prisma.InputJsonValue, completedAt: new Date(), expiresAt };
  try {
    const saved = await db.marketGapAnalysis.create({ data });
    return { analysisId: saved.id.toString(), cacheHit: false, persisted: true, result };
  } catch (error) {
    const cached = await db.marketGapAnalysis.findUnique({ where: { fingerprint } });
    if (cached) return { analysisId: cached.id.toString(), cacheHit: true, persisted: true, result: cached.result as unknown as MarketGapResult };
    throw error;
  }
}

export async function readMarketGapAnalysis(id: bigint) {
  const row = await db.marketGapAnalysis.findUnique({ where: { id } });
  if (!row) throw AppError.notFound('Không tìm thấy kết quả Tìm khoảng trống thị trường');
  const result = row.result as unknown as MarketGapResult;
  if (result.scoringVersion !== SCORE_VERSION) throw new AppError('Kết quả phân tích dùng phiên bản tính điểm cũ. Hãy phân tích lại.',409,'MARKET_GAP_ANALYSIS_OUTDATED');
  return { analysisId: row.id.toString(), result };
}

export async function readMarketGapNiche(id: bigint, nicheKey: string): Promise<MarketGapNicheDetail> {
  const { result } = await readMarketGapAnalysis(id);
  const niche = result.niches.find(n => n.key === nicheKey);
  if (!niche) throw AppError.notFound('Không tìm thấy ngách này');
  const now = new Date();
  const currentEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  const currentStart = new Date(currentEnd.getTime() - (result.request.days - 1) * 86400000);
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - (result.request.days - 1) * 86400000);
  const subId = niche.subCategory?.id;
  const products = await loadScopeProducts(result.request.categoryId, subId, result.request.currency, result.request.market, result.request.mode === 'DEEP' ? 500 : 200);
  const computed = computeNiche(products, currentStart, currentEnd, previousStart, previousEnd);
  const asOf = products.flatMap(product => product.observations.map(observation => observation.observedAt?.toISOString() ?? observation.importedAt.toISOString())).sort().at(-1) ?? null;
  const stale = !asOf || Date.now() - Date.parse(asOf) > 30 * 86400000;
  return {
    ...niche,
    history: computed.history,
    topProducts: computed.topProducts,
    topShops: computed.topShops,
    strengths: [], weaknesses: [], risks: [],
    evidence: computed.evidence,
    asOf, stale,
  };
}

export function buildNicheEvidencePack(detail: MarketGapNicheDetail, category: { id: number; name: string }): EvidencePack {
  const pack: EvidencePack = {
    version: 'mi-evidence-v1', scoringVersion: SCORE_VERSION, reportVersion: 'mi-report-v1', fingerprint: '',
    request: { entityType: 'CATEGORY', entityId: String(category.id), module: 'OPPORTUNITY_DISCOVERY', mode: 'OPPORTUNITY', audience: 'SELLER', days: 30, compareIds: [] },
    entity: { id: String(detail.subCategory?.id ?? category.id), type: 'CATEGORY', name: detail.subCategory?.name ?? category.name },
    scope: 'Tìm khoảng trống thị trường · một ngách · đơn vị tiền tệ riêng', asOf: detail.asOf, preparedAt: new Date().toISOString(), stale: detail.stale,
    evidence: detail.evidence, history: {}, relations: [], charts: detail.history, scores: detail.scores, opportunityScore: detail.opportunityScore, evidenceConfidence: detail.evidenceConfidence,
    candidates: [{ id: `market-gap-${detail.key}`, type: 'NICHE', entityKey: detail.key, title: detail.subCategory?.name ?? category.name, priority: detail.opportunityScore !== null && detail.opportunityScore >= 80 ? 'HIGH' : 'MEDIUM', score: detail.opportunityScore, confidence: detail.evidenceConfidence, evidenceIds: detail.evidence.slice(0, 30).map(item => item.id), limitations: detail.limitations, nextAction: 'Xác minh nguồn cung, giá nhập và nhu cầu thực tế trước khi thử nghiệm.' }], missing: detail.missingRequiredMetrics,
    limitations: ['Số shop quan sát được là cận dưới của dataset', 'Giá trị bán là ước tính theo giá hiện tại, không phải doanh thu thực tế'],
    sourcePolicy: { canSendToProvider: true, blockedSources: [] },
    sample: { selected: detail.evidence.length, available: detail.evidence.length, truncated: false },
  };
  pack.fingerprint = hash({ ...pack, preparedAt: undefined, fingerprint: undefined });
  return pack;
}
