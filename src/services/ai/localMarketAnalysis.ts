import { createHash } from 'node:crypto';
import { AppError } from '../../utils/errors.js';
import { ENTITY_TYPES, MODULES, MODES, SECTIONS, type AnalysisRequest, type EvidencePack, type LocalAnalysis, type MarketReport, type Execution } from './marketIntelligenceTypes.js';
export function parseAnalysisRequest(input:unknown):{request:AnalysisRequest;execution:Execution}{
 if(!input||typeof input!=='object'||Array.isArray(input))throw AppError.badRequest('Body phải là object');
 const x=input as Record<string,unknown>;
 const entityType=x.entityType??'MARKET',module=x.module??'OPPORTUNITY_DISCOVERY',mode=x.mode??'QUICK',audience=x.audience??'SELLER',execution=x.execution??'LOCAL';
 if(!ENTITY_TYPES.includes(entityType as never)||!MODULES.includes(module as never)||!MODES.includes(mode as never)||!['SELLER','AFFILIATE','MCN'].includes(String(audience))||!['LOCAL','MOCK'].includes(String(execution)))throw AppError.badRequest('Loại thực thể, module, chế độ hoặc audience không hợp lệ');
 const entityId=String(x.entityId??(entityType==='MARKET'?'VN':''));
 const validId=(v:string)=>/^[1-9][0-9]*$/.test(v)&&Number.isSafeInteger(Number(v))&&Number(v)<=2147483647;
 if(entityType==='MARKET'?entityId!=='VN':entityType==='CATEGORY'?(!entityId.trim()||entityId.length>150):!validId(entityId))throw AppError.badRequest('Entity ID không hợp lệ; MARKET chỉ hỗ trợ mẫu VN');
 const days=x.days??30;if(typeof days!=='number'||!Number.isInteger(days)||days<1||days>90)throw AppError.badRequest('days phải là số nguyên từ 1 đến 90');
 const compare=x.compareIds??[];if(!Array.isArray(compare)||compare.length>4||compare.some(v=>typeof v!=='string'||!validId(v)))throw AppError.badRequest('compareIds tối đa 4 ID dạng chuỗi số');
 if(compare.length&&['MARKET','CATEGORY'].includes(String(entityType)))throw AppError.badRequest('So sánh hiện hỗ trợ Product, Shop, Creator channel và Video');
 if(mode==='COMPARISON'&&!compare.length)throw AppError.badRequest('Chế độ COMPARISON cần ít nhất một ID đối chứng');
 if(x.force!==undefined&&typeof x.force!=='boolean')throw AppError.badRequest('force phải là boolean');
 return {execution:execution as Execution,request:{entityType:entityType as AnalysisRequest['entityType'],entityId,module:module as AnalysisRequest['module'],mode:mode as AnalysisRequest['mode'],audience:audience as AnalysisRequest['audience'],days,compareIds:[...new Set(compare)].filter(v=>v!==entityId),force:x.force===true}};
}
export function buildMockPack(request:AnalysisRequest):EvidencePack {
 const {force:_,...scope}=request;
 // MOCK intentionally contains no business numbers or fabricated time series.
 const pack:EvidencePack={version:'mi-evidence-v1',scoringVersion:'mi-score-v1',reportVersion:'mi-report-v1',fingerprint:'',request:scope,entity:{id:request.entityId,type:request.entityType,name:'MOCK — kiểm thử giao diện, không phải dữ liệu kinh doanh'},scope:'MOCK isolated fixture; no PostgreSQL or provider calls',asOf:null,preparedAt:new Date().toISOString(),stale:false,evidence:[{id:'mock-unavailable',entityId:request.entityType+':'+request.entityId,entityType:request.entityType,metric:'mockUnavailableMetric',value:null,unit:'not applicable',currency:null,dataKind:'SIMULATED',state:'NO_DATA',observedAt:null,source:'MOCK_FIXTURE',usageRestriction:'TEST_ONLY',recordIds:[],fileHashes:[],formula:null,inputIds:[],limitations:['MOCK does not establish commercial facts or attribution']}],history:{},relations:[],charts:[{id:'mock-empty',type:'line',title:'MOCK — kiểm tra trạng thái thiếu dữ liệu',unit:'not applicable',period:'Không có kỳ thực tế',dataKind:'SIMULATED',state:'NO_DATA',labels:[],values:[],evidenceIds:['mock-unavailable']}],scores:[],opportunityScore:null,evidenceConfidence:0,candidates:[],missing:['MOCK_NO_BUSINESS_DATA'],limitations:['Chỉ kiểm thử luồng và giao diện; không được dùng cho KPI'],sourcePolicy:{canSendToProvider:false,blockedSources:['MOCK_FIXTURE:TEST_ONLY']},sample:{selected:0,available:0,truncated:false}};
 pack.fingerprint=createHash('sha256').update(JSON.stringify({...pack,preparedAt:undefined,fingerprint:undefined})).digest('hex');return pack;
}
export function buildLocalReport(pack:EvidencePack):MarketReport {
 const sections={} as MarketReport['sections'];
 for(const key of SECTIONS)sections[key]={findings:[]};
 const report:MarketReport={version:'mi-report-v1',sections,chartIds:pack.charts.map(c=>c.id),opportunityIds:pack.candidates.map(c=>c.id)};
 const add=(section:typeof SECTIONS[number],statement:string,evidenceIds:string[]=[],type:'FACT'|'ANALYSIS'|'RECOMMENDATION'='ANALYSIS')=>report.sections[section].findings.push({type,statement,evidenceIds,confidence:evidenceIds.length?'LOW':'INSUFFICIENT_DATA',limitations:[]});
 add('executiveSummary','Báo cáo cấp một do backend tổng hợp theo quy tắc, không phải nhận định từ mô hình AI. Phạm vi chỉ là mẫu đã chọn.');
 add('keyFindings','Giá trị, nguồn và công thức của từng chỉ số được trình bày trực tiếp trong bảng bằng chứng. Không đồng nhất số bán lũy kế với doanh số theo kỳ.',pack.evidence.filter(e=>e.value!==null).slice(0,8).map(e=>e.id),'FACT');
 add('detailedAnalysis',`Mục tiêu xử lý: ${pack.request.module}; đối tượng sử dụng: ${pack.request.audience}. Chưa đủ căn cứ kết luận về lợi nhuận hay khả năng tạo đơn.`);
 add('dataEvidence','Bằng chứng được cấp ID bởi backend. Giá trị null được giữ nguyên; số liệu dẫn xuất có công thức và ID đầu vào.',pack.evidence.slice(0,10).map(e=>e.id),'FACT');
 add('trendAnalysis',Object.values(pack.history).some(points=>points.filter(p=>p.value!==null).length>1)?'Có nhiều số đo theo ngày. Biểu đồ mô tả chuỗi quan sát, không chứng minh tăng trưởng toàn kỳ hoặc quan hệ nhân quả.':'Không đủ lịch sử để xác định xu hướng. Không tạo đường tăng trưởng.',Object.values(pack.history).flat().slice(0,8).map(p=>p.evidenceId));
 add('competitiveAnalysis','Chỉ so sánh các thực thể cùng đơn vị, tiền tệ và kỳ đo. Các đối chứng được nhập là phạm vi so sánh, không phải toàn bộ thị trường.');
 add('relationshipAnalysis',pack.relations.length?'Sơ đồ chỉ chứa quan hệ hiện có trong database; đường dẫn gián tiếp được ghi riêng và không mang nghĩa attribution.':'Không có quan hệ xác minh trong mẫu được chọn.',pack.relations.slice(0,8).flatMap(r=>r.evidenceIds));
 add('opportunityDiscovery',pack.candidates.length?'Có đầu mối Product cần nghiên cứu thêm từ percentile số bán lũy kế. Chưa đủ điều kiện tính điểm cơ hội tổng hợp.':'Không có candidate đủ điều kiện theo quy tắc hiện tại. Không bổ sung cơ hội giả để làm đầy báo cáo.',pack.candidates.flatMap(c=>c.evidenceIds).slice(0,20));
 add('riskAssessment','Nguồn chưa xác minh, mẫu bị giới hạn, dữ liệu cũ và thiếu attribution có thể làm sai quyết định kinh doanh. Evidence Confidence chỉ đo độ đầy đủ của bằng chứng.');
 const actions={SELLER:'Xác minh giá nhập, chi phí, tồn kho, biên lợi nhuận và doanh số theo kỳ trước khi quyết định bán.',AFFILIATE:'Xác minh liên kết quảng bá, điều kiện hoa hồng và chuyển đổi thực trước khi thử nghiệm nội dung.',MCN:'Xác minh danh tính channel, lịch hoạt động và phù hợp nội dung; không dùng lượt xem để cam kết doanh số.'};
 add('strategicRecommendations',actions[pack.request.audience],pack.candidates.flatMap(c=>c.evidenceIds).slice(0,10),'RECOMMENDATION');
 for(const text of [...pack.limitations,...pack.missing])add('dataLimitations',text);
 add('conclusion','Sử dụng kết quả để lập danh sách cần kiểm chứng, không coi đây là dự báo kinh doanh hoặc đánh giá toàn thị trường.');
 return report;
}
export function localResult(pack:EvidencePack,execution:Execution):LocalAnalysis {return {execution,status:execution==='MOCK'?'MOCK_COMPLETE':'LOCAL_COMPLETE',providerCalled:false,persisted:false,usage:{providerRequests:0,inputTokens:0,outputTokens:0,billable:false},pack,report:buildLocalReport(pack)};}
