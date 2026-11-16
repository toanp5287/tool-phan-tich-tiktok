import assert from 'node:assert/strict';
import {env} from '../dist/config/env.js';
import {datasetDb as db,datasetPool} from '../dist/config/datasetDb.js';
import {SECTIONS} from '../dist/services/ai/marketIntelligenceTypes.js';
import {buildMockPack,parseAnalysisRequest} from '../dist/services/ai/localMarketAnalysis.js';
import {analyzeMarketWithGemini,assertProviderEligibility} from '../dist/services/ai/marketGeminiAnalysis.js';
import {serializeProductReport} from '../dist/services/ai/productReportCompatibility.js';
import {createApp} from '../dist/app.js';
const base=buildMockPack(parseAnalysisRequest({execution:'MOCK',entityType:'PRODUCT',entityId:'1000000014'}).request);
base.evidence[0].dataKind='UNKNOWN';
const report={version:'mi-report-v1',sections:Object.fromEntries(SECTIONS.map(k=>[k,{findings:[{type:'ANALYSIS',statement:'Chưa đủ dữ liệu để kết luận.',evidenceIds:[base.evidence[0].id],confidence:'LOW',limitations:[]}]}])),chartIds:base.charts.map(c=>c.id),opportunityIds:[]};
const original={fetch:globalThis.fetch,provider:env.ai.provider,enabled:env.gemini.enabled,key:env.gemini.apiKey,transaction:db.$transaction,create:db.aiAnalysisReport.create,update:db.aiUsageCounter.update,findMany:db.aiAnalysisReport.findMany,findUnique:db.aiAnalysisReport.findUnique};
const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let calls=0,saved=[],quota=false,counterUpdates=[];
try{
  env.ai.provider='google';env.gemini.enabled=true;env.gemini.apiKey='test-only-not-a-real-key';
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(report)}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10,totalTokenCount:30}}),{status:200});};
  db.$transaction=async work=>typeof work==='function'?work({$queryRaw:async()=>[],aiUsageCounter:{upsert:async()=>({id:1,requestCount:quota?env.gemini.maxAnalysesPerDay:0}),aggregate:async()=>({_sum:{requestCount:0}}),update:async args=>{counterUpdates.push(args.data);return {}; }},aiAnalysisReport:{findMany:async()=>[],create:async({data})=>{saved.push(data);return {id:BigInt(saved.length),...data,requestedAt:new Date(),completedAt:new Date()};}}}):Promise.all(work);
 db.aiUsageCounter.update=async()=>({});
 for(const permission of ['VERIFIED','UNVERIFIED','UNKNOWN','COMMERCIAL_ALLOWED',undefined]){
  const pack=structuredClone(base);pack.evidence[0].usageRestriction=permission;
  const result=await analyzeMarketWithGemini(pack);assert.equal(result.persisted,true);assert.ok(result.reportId);
  const stored=saved.at(-1);assert.equal(stored.status,'COMPLETED');assert.equal(stored.report.pack.evidence[0].usageRestriction,permission);
  assert.ok(serializeProductReport({id:1n,...stored}).report.executiveSummary.findings.length);
 }
  const before=calls;quota=true;await assert.rejects(analyzeMarketWithGemini(base),e=>e.statusCode===429&&e.code==='AI_RATE_LIMITED'&&e.details.scope==='GLOBAL_DAILY'&&e.details.current===env.gemini.maxAnalysesPerDay&&e.details.limit===env.gemini.maxAnalysesPerDay&&e.details.retryAfterSeconds>0);assert.equal(calls,before);quota=false;
 env.gemini.enabled=false;await assert.rejects(analyzeMarketWithGemini(base),e=>e.code==='AI_UNAVAILABLE');assert.equal(calls,before);
 env.gemini.enabled=true;env.gemini.apiKey='';await assert.rejects(analyzeMarketWithGemini(base),e=>e.code==='AI_UNAVAILABLE');assert.equal(calls,before);env.gemini.apiKey='test-only';
 const simulated=structuredClone(base);simulated.evidence[0].dataKind='SIMULATED';await assert.rejects(analyzeMarketWithGemini(simulated),e=>e.code==='AI_SIMULATED_EVIDENCE_BLOCKED');assert.equal(calls,before);
 assert.throws(()=>assertProviderEligibility({...base,evidence:[{id:'bad'}]},true,true),e=>e.code==='INVALID_EVIDENCE_PACK');
  const savedBefore=saved.length;globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]}),{status:200});
  await assert.rejects(analyzeMarketWithGemini(base),e=>e.code==='AI_INVALID_RESPONSE');assert.equal(saved.length,savedBefore);
  counterUpdates=[];globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'bad request'}}),{status:400});
  await assert.rejects(analyzeMarketWithGemini(base),e=>e.code==='AI_INVALID_REQUEST');assert.ok(counterUpdates.some(data=>data.requestCount?.decrement===1),'Confirmed pre-generation provider rejection releases logical reservation');
 // Exercise the formerly blocked Product endpoint with real read-only evidence and fake provider/storage.
 globalThis.fetch=async(url,...args)=>{
  if(String(url).startsWith(origin))return original.fetch(url,...args);
  assert.ok(String(url).startsWith(env.gemini.baseUrl+'/models/'),'No other external service is allowed');
  const request=JSON.parse(args[0].body),pack=JSON.parse(request.contents[0].parts[0].text);calls++;
  const narrative=structuredClone(report);for(const section of Object.values(narrative.sections))for(const finding of section.findings)finding.evidenceIds=[pack.evidence[0].id];narrative.chartIds=pack.charts.map(c=>c.id);
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(narrative)}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10,totalTokenCount:30}}),{status:200});
 };
 db.aiAnalysisReport.findMany=async()=>[];
 const product=await db.product.findFirst({where:{market:'VN'},select:{id:true}});
 const headers={'Content-Type':'application/json',...(env.adminToken?{'x-admin-token':env.adminToken}:{})};
 const response=await fetch(origin+'/api/products/'+product.id+'/ai-analysis',{method:'POST',headers,body:JSON.stringify({days:30,force:true})});
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.data.persisted,true);
 const latest=saved.at(-1);assert.ok(latest.report.pack.evidence.some(e=>e.usageRestriction!=='COMMERCIAL_ALLOWED'));
 db.aiAnalysisReport.findUnique=async()=>({id:BigInt(result.data.id),...latest});
 const reloaded=await fetch(origin+'/api/ai-analysis/'+result.data.id).then(r=>r.json());assert.equal(reloaded.success,true);assert.ok(reloaded.data.report.executiveSummary.findings.length);
 console.log(JSON.stringify({result:'PASS',permissionCases:5,mockedProviderSuccesses:calls,mockedProductReports:saved.length,quotaBlocksBeforeProvider:true,realProviderRequests:0,realDatabaseWrites:0}));
}finally{globalThis.fetch=original.fetch;env.ai.provider=original.provider;env.gemini.enabled=original.enabled;env.gemini.apiKey=original.key;db.$transaction=original.transaction;db.aiAnalysisReport.create=original.create;db.aiUsageCounter.update=original.update;db.aiAnalysisReport.findMany=original.findMany;db.aiAnalysisReport.findUnique=original.findUnique;await new Promise(resolve=>server.close(resolve));await db.$disconnect();await datasetPool.end();}
