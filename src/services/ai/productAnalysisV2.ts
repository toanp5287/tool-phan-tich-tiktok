import {AppError} from '../../utils/errors.js';
import {buildEvidencePack} from './marketAnalyticsEngine.js';
import {parseAnalysisRequest} from './localMarketAnalysis.js';
import {analyzeProductFlexible,assertProviderEligibility} from './marketGeminiAnalysis.js';
import {cachedProductFlexibleReport} from './productReportCompatibility.js';
import {providerConfigurationError} from './aiProvider.js';
const pending=new Map<string,Promise<unknown>>();
export async function createProductAnalysisV2(productId:number,input:unknown){
 if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw AppError.badRequest('Body không hợp lệ');
 const body=(input??{}) as Record<string,unknown>;
 if(body.execution!==undefined&&body.execution!=='LOCAL')throw AppError.badRequest('Endpoint Product AI không xử lý MOCK; dùng endpoint phân tích cục bộ.');
 const {request}=parseAnalysisRequest({...body,entityType:'PRODUCT',entityId:String(productId),execution:'LOCAL',module:'ENTITY_DEEP_ANALYSIS',mode:'DEEP'});
  const providerError=providerConfigurationError();if(providerError)throw providerError;
 const key=JSON.stringify(request);const existing=pending.get(key);if(existing)return existing;
 const task=(async()=>{const pack=await buildEvidencePack(request);assertProviderEligibility(pack);if(!request.force){const cached=await cachedProductFlexibleReport(pack);if(cached)return cached;}const result=await analyzeProductFlexible(pack);if(!result.reportId)throw new AppError('Không lưu được báo cáo Product.',500,'AI_REPORT_NOT_SAVED');return {id:result.reportId,status:'COMPLETED',persisted:true,report:result.report,format:result.format,model:result.model};})();
 pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
