import assert from 'node:assert/strict';
import {env} from '../dist/config/env.js';
import {SECTIONS} from '../dist/services/ai/marketIntelligenceTypes.js';
import {buildMockPack,parseAnalysisRequest} from '../dist/services/ai/localMarketAnalysis.js';
import {isMarketReport} from '../dist/services/ai/marketReportValidator.js';
import {assertProviderEligibility,requestMarketGapMarkdown,requestMarketNarrative} from '../dist/services/ai/marketGeminiAnalysis.js';
const pack=buildMockPack(parseAnalysisRequest({execution:'MOCK'}).request);
pack.evidence[0].dataKind='UNKNOWN';pack.evidence[0].source='TEST';pack.evidence[0].usageRestriction='COMMERCIAL_ALLOWED';
pack.sourcePolicy={canSendToProvider:true,blockedSources:[]};
const report={version:'mi-report-v1',sections:Object.fromEntries(SECTIONS.map(k=>[k,{findings:[{type:'ANALYSIS',statement:'Chưa đủ dữ liệu để kết luận về thị trường.',evidenceIds:['mock-unavailable'],confidence:'LOW',limitations:['Chỉ kiểm thử bằng chứng.']}]}])),chartIds:['mock-empty'],opportunityIds:[]};
assert.ok(isMarketReport(report,pack));
for(const mutate of [r=>r.chartIds.push('invented'),r=>r.sections.keyFindings.findings[0].evidenceIds.push('invented'),r=>r.sections.keyFindings.findings[0].statement='Doanh thu tăng 100%',r=>r.opportunityIds.push('fake'),r=>r.sections.keyFindings.findings[0].value=10]){const bad=structuredClone(report);mutate(bad);assert.equal(isMarketReport(bad,pack),false);}
assert.throws(()=>assertProviderEligibility(pack,false,true),e=>e.code==='AI_UNAVAILABLE');
for(const permission of ['UNVERIFIED','UNKNOWN','ACADEMIC_ONLY','NOT_DECLARED']){const unapproved=structuredClone(pack);unapproved.evidence[0].usageRestriction=permission;unapproved.sourcePolicy={canSendToProvider:false,blockedSources:['TEST:'+permission]};assert.doesNotThrow(()=>assertProviderEligibility(unapproved,true,true),permission);}
const simulated=structuredClone(pack);simulated.evidence[0].dataKind='SIMULATED';assert.throws(()=>assertProviderEligibility(simulated,true,true),e=>e.code==='AI_SIMULATED_EVIDENCE_BLOCKED');
const oldFetch=globalThis.fetch,oldEnabled=env.gemini.enabled,oldKey=env.gemini.apiKey,oldProvider=env.ai.provider;let mockedCalls=0;
try{
  env.ai.provider='google';env.gemini.enabled=true;env.gemini.apiKey='unit-test-not-a-key';
 globalThis.fetch=async()=>{mockedCalls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(report)}]}}],usageMetadata:{promptTokenCount:70,candidatesTokenCount:30,totalTokenCount:100}}),{status:200});};
  const result=await requestMarketNarrative(pack);assert.equal(result.inputTokens,70);assert.equal(result.outputTokens,30);assert.equal(result.totalTokens,100);
  const markdown='## Tổng quan\n\nDữ liệu hiện có chỉ đủ cho nhận định sơ bộ.\n\n- Không có lịch sử quan sát.';
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:markdown}]}}],usageMetadata:{promptTokenCount:11,candidatesTokenCount:7,totalTokenCount:18}}),{status:200});
  const flexible=await requestMarketGapMarkdown(pack);assert.equal(flexible.report.format,'markdown');assert.equal(flexible.report.content,markdown);
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'   '}]}}]}),{status:200});await assert.rejects(requestMarketGapMarkdown(pack),e=>e.code==='AI_INVALID_RESPONSE');
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{finishReason:'length',content:{parts:[{text:markdown}]}}]}),{status:200});await assert.rejects(requestMarketGapMarkdown(pack),e=>e.code==='AI_INCOMPLETE_OUTPUT');
 globalThis.fetch=async()=>new Response('not JSON',{status:200});await assert.rejects(requestMarketNarrative(pack),e=>e.code==='AI_INVALID_RESPONSE');
  globalThis.fetch=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{broken'}]}}]}),{status:200});await assert.rejects(requestMarketNarrative(pack),e=>e.code==='AI_INVALID_RESPONSE');
  let repairCalls=0;
  globalThis.fetch=async()=>{repairCalls++;const output=repairCalls===1?{...report,sections:{...report.sections,executiveSummary:{findings:[]}}}:report;return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}],usageMetadata:{promptTokenCount:70,candidatesTokenCount:30,totalTokenCount:100}}),{status:200});};
  const repaired=await requestMarketNarrative(pack);assert.ok(repaired.report);assert.equal(repairCalls,2,'A parsed schema failure gets one repair request');
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'mock failure'}}),{status:400});await assert.rejects(requestMarketNarrative(pack),e=>e.code==='AI_INVALID_REQUEST');
  let callsBeforeSuccess=0;
  globalThis.fetch=async()=>{callsBeforeSuccess++;if(callsBeforeSuccess===1)throw Error('connection failed');return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(report)}]}}]}),{status:200});};
  const retryResult=await requestMarketNarrative(pack);assert.ok(retryResult.report);assert.equal(callsBeforeSuccess,2,'Network errors retry once by default');
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'invalid request'}}),{status:400});await assert.rejects(requestMarketNarrative(pack),e=>e.code==='AI_INVALID_REQUEST');
  globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'model missing'}}),{status:404});await assert.rejects(requestMarketNarrative(pack),e=>e.code==='AI_MODEL_NOT_FOUND');
 console.log(JSON.stringify({result:'PASS',transport:'mocked fetch only',realProviderRequests:0,databaseWrites:0,mockedSuccesses:mockedCalls}));
}finally{globalThis.fetch=oldFetch;env.ai.provider=oldProvider;env.gemini.enabled=oldEnabled;env.gemini.apiKey=oldKey;}
