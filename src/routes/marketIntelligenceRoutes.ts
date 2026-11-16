import { Router } from 'express';
import { env } from '../config/env.js';
import { providerConfigurationError, providerModel } from '../services/ai/aiProvider.js';
import { AppError } from '../utils/errors.js';
import { asyncHandler, sendSuccess } from '../utils/http.js';
import { buildEvidencePack } from '../services/ai/marketAnalyticsEngine.js';
import { buildMockPack, localResult, parseAnalysisRequest } from '../services/ai/localMarketAnalysis.js';
import { ENTITY_TYPES, MODULES, MODES } from '../services/ai/marketIntelligenceTypes.js';
import {analyzeMarketWithGemini} from '../services/ai/marketGeminiAnalysis.js';
import {analyzeMarketGapWithGemini} from '../services/ai/marketGeminiAnalysis.js';
import {getOrCreateMarketGapAnalysis,parseMarketGapRequest,readMarketGapAnalysis,readMarketGapNiche,buildNicheEvidencePack} from '../services/ai/marketGapAnalyticsService.js';
import { discoverMarketOpportunities } from '../services/marketIntelligence/marketDiscoveryService.js';
import { datasetDb as db } from '../config/datasetDb.js';
import {findCompletedMarketGapReport, getMarketGapReport, listMarketGapReports, saveMarketGapReport} from '../services/ai/marketGapReportPersistence.js';
import type {EvidencePack} from '../services/ai/marketIntelligenceTypes.js';
const router=Router();
let active=0;
router.get('/capabilities',(_req,res)=>{
 const providerError=providerConfigurationError();
 sendSuccess(res,{
   level:1,executions:['LOCAL','MOCK'],entityTypes:ENTITY_TYPES,modules:MODULES,modes:MODES,
   providerCalls:false,persistence:false,provider:env.ai.provider,model:providerModel(),
    ai:{endpoint:'/api/market-intelligence/ai-analyses',requiresExplicitConfirmation:true,enabled:!providerError,sourcePermissionPrecondition:false,usageReserved:true,reportPersistence:'PRODUCT_ONLY'},
    marketGap:{enabled:true,scopeLevels:['CATEGORY','SUBCATEGORY'],currenciesMustBeSeparated:true,days:[7,30,90],level1Persistence:true,level2NarrativePersistence:true,aiStaleThresholdDays:30,minEvidenceConfidenceForResearchLeadAi:60},
  limitations:['Local reports never call a provider; provider calls require explicit user confirmation','Source permission is provenance, not an eligibility gate or rights certification','Only Product AI reports can be persisted with the existing schema','Only PRODUCT research leads supported; other opportunity scores may be null'],
 });
});
router.post('/analyses',asyncHandler(async(req,res)=>{
 if(env.adminToken&&req.get('x-admin-token')!==env.adminToken)throw AppError.unauthorized('Token quản trị không hợp lệ');
 const {request,execution}=parseAnalysisRequest(req.body);
 if(execution==='MOCK'){sendSuccess(res,localResult(buildMockPack(request),execution));return;}
 if(active>=2)throw AppError.tooManyRequests('Đang xử lý phân tích cục bộ; thử lại khi hoàn tất.');
 active++;try{const pack=await buildEvidencePack(request);sendSuccess(res,localResult(pack,execution));}finally{active--;}
}));
router.post('/market-gaps/analyses',asyncHandler(async(req,res)=>{
 if(env.adminToken&&req.get('x-admin-token')!==env.adminToken)throw AppError.unauthorized('Token quản trị không hợp lệ');
 if(active>=2)throw AppError.tooManyRequests('Đang xử lý phân tích cục bộ; thử lại khi hoàn tất.');
 active++;try{const output=await getOrCreateMarketGapAnalysis(parseMarketGapRequest(req.body));sendSuccess(res,{execution:'LOCAL',providerCalled:false,persisted:output.persisted,analysisId:output.analysisId,cache:{hit:output.cacheHit,fingerprint:output.result.evidencePack.fingerprint},result:output.result,aiEligibility:output.result.aiEligibility});}finally{active--;}
}));
router.get('/market-gaps/analyses/:id',asyncHandler(async(req,res)=>{
 const raw=String(req.params.id);if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('Analysis ID không hợp lệ');sendSuccess(res,await readMarketGapAnalysis(BigInt(raw)));
}));
router.get('/market-gaps/analyses/:id/niches/:key',asyncHandler(async(req,res)=>{
 const raw=String(req.params.id);if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('Analysis ID không hợp lệ');sendSuccess(res,await readMarketGapNiche(BigInt(raw),String(req.params.key)));
}));
router.post('/market-gaps/ai-analyses',asyncHandler(async(req,res)=>{
 if(env.adminToken&&req.get('x-admin-token')!==env.adminToken)throw AppError.unauthorized('Token quản trị không hợp lệ');
 if(req.body?.confirmProviderCall!==true)throw AppError.badRequest('Cần xác nhận gọi Gemini bằng thao tác người dùng.');
 const raw=String(req.body?.analysisId??'');if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('Analysis ID không hợp lệ');
 const nicheKey=req.body?.nicheKey?String(req.body.nicheKey):null;
  const stored=await readMarketGapAnalysis(BigInt(raw));const result=stored.result;
 let pack:EvidencePack;
   if(nicheKey){const detail=await readMarketGapNiche(BigInt(raw),nicheKey);if(detail.productCount<=0||detail.evidence.length===0)throw new AppError('Ngách chưa có bằng chứng thực tế để phân tích AI.',409,'MARKET_GAP_AI_INELIGIBLE',{productCount:detail.productCount,evidenceCount:detail.evidence.length});pack=buildNicheEvidencePack(detail,result.scope.category);if(pack.evidence.length===0)throw new AppError('Evidence Pack rỗng; không gọi AI.',409,'MARKET_GAP_AI_INELIGIBLE');}
  else {throw AppError.badRequest('Cần chọn một ngách cụ thể để phân tích chuyên sâu.');}
  const cached=await findCompletedMarketGapReport(BigInt(raw),nicheKey,pack.fingerprint);
  if(cached){sendSuccess(res,{analysisId:stored.analysisId,nicheKey,providerCalled:false,persisted:true,execution:'CACHED',report:cached.report,storedReport:cached,pack});return;}
  if(active>=2)throw AppError.tooManyRequests('Đang xử lý phân tích.');
  active++;try{const generated=await analyzeMarketGapWithGemini(pack);const storedReport=await saveMarketGapReport({analysisId:BigInt(raw),nicheKey,provider:env.ai.provider,model:providerModel(),pack,report:generated.report,usage:generated.usage});sendSuccess(res,{analysisId:stored.analysisId,nicheKey,...generated,persisted:true,storedReport});}finally{active--;}
}));
router.get('/market-gaps/analyses/:id/niches/:key/reports',asyncHandler(async(req,res)=>{
 const raw=String(req.params.id);if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('Analysis ID không hợp lệ');sendSuccess(res,await listMarketGapReports(BigInt(raw),String(req.params.key)));
}));
router.get('/market-gaps/ai-reports/:id',asyncHandler(async(req,res)=>{
 const raw=String(req.params.id);if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('Report ID không hợp lệ');const report=await getMarketGapReport(BigInt(raw));if(!report)throw AppError.notFound('Không tìm thấy báo cáo AI ngách thị trường');sendSuccess(res,report);
}));
router.get('/analyses',(_req,res)=>sendSuccess(res,{items:[],state:'NOT_SUPPORTED',reason:'Báo cáo cấp một không được lưu; chưa có migration hoặc ghi database.'}));
router.post('/ai-analyses',asyncHandler(async(req,res)=>{
 if(env.adminToken&&req.get('x-admin-token')!==env.adminToken)throw AppError.unauthorized('Token quản trị không hợp lệ');
 if(req.body?.confirmProviderCall!==true)throw AppError.badRequest('Cần xác nhận gọi Gemini bằng thao tác người dùng.');
 if(req.body?.execution!=='LOCAL')throw AppError.badRequest('Không gửi MOCK tới Gemini.');
  const providerError=providerConfigurationError();if(providerError)throw providerError;
 const {request}=parseAnalysisRequest(req.body);
 if(active>=2)throw AppError.tooManyRequests('Đang xử lý phân tích.');
  active++;try{const pack=await buildEvidencePack(request);sendSuccess(res,await analyzeMarketWithGemini(pack));}finally{active--;}
}));

// ─── Market Intelligence: niche opportunity discovery (Giai đoạn 2) ───
const parseMarket = (v: unknown): string | null => { const s = String(v ?? '').trim().toUpperCase(); return s === '' || s === 'ALL' ? null : s; };
const parseIdOpt = (v: unknown): number | undefined => { const s = String(v ?? ''); return /^[1-9][0-9]*$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined; };
router.get('/markets',asyncHandler(async(_req,res)=>{
  const rows = await db.$queryRawUnsafe<{ market: string | null; n: number }[]>('SELECT market, count(*)::int AS n FROM "Product" GROUP BY market ORDER BY n DESC');
  sendSuccess(res, { markets: rows.map((r) => ({ code: r.market, productCount: r.n })) });
}));
router.get('/opportunities',asyncHandler(async(req,res)=>{
  const market = parseMarket(req.query.market);
  const categoryId = parseIdOpt(req.query.categoryId);
  const subCategoryId = parseIdOpt(req.query.subCategoryId);
  const days = Number(req.query.days ?? 30);
  const mode = String(req.query.mode ?? 'real_data').toLowerCase() === 'simulation' ? 'SIMULATION' : 'REAL_DATA';
  const niches = await discoverMarketOpportunities({ market, categoryId, subCategoryId, days, mode });
  // Server-side filter + sort by score desc.
  let filtered = niches.filter((n) => n.opportunityScore !== null);
  const minScore = Number(req.query.minScore ?? 0);
  if (Number.isFinite(minScore)) filtered = filtered.filter((n) => (n.opportunityScore ?? 0) >= minScore);
  const competition = String(req.query.competition ?? '');
  if (['LOW','MODERATE','HIGH','SATURATED'].includes(competition)) filtered = filtered.filter((n) => n.competitionLevel === competition);
  const growth = String(req.query.growth ?? '');
  if (growth === 'rising') filtered = filtered.filter((n) => (n.growth30d ?? -999) > 0);
  if (growth === 'declining') filtered = filtered.filter((n) => (n.growth30d ?? 999) < 0);
  filtered.sort((a, b) => (b.opportunityScore ?? -1) - (a.opportunityScore ?? -1));
  // Pagination.
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  sendSuccess(res, { mode, days, market, total: filtered.length, page, pageSize, items, summary: {
    totalNiches: niches.length,
    scoredNiches: niches.filter((n) => n.opportunityScore !== null).length,
    emerging: filtered.filter((n) => n.classification === 'EMERGING_WINNER').length,
    highOpportunity: filtered.filter((n) => (n.opportunityScore ?? 0) >= 70).length,
    saturated: filtered.filter((n) => n.classification === 'SATURATED_MARKET').length,
    insufficient: niches.filter((n) => n.classification === 'INSUFFICIENT_DATA').length,
  } });
}));
export default router;
