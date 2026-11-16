import assert from 'node:assert/strict';
import {createApp} from '../dist/app.js';
import {datasetDb as db,datasetPool as pool} from '../dist/config/datasetDb.js';
import {parseAnalysisRequest,buildMockPack,localResult} from '../dist/services/ai/localMarketAnalysis.js';
import {buildEvidencePack} from '../dist/services/ai/marketAnalyticsEngine.js';
import {growth,percentile,scoreEvidence} from '../dist/services/ai/opportunityScoring.js';
const server=createApp().listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const realFetch=globalThis.fetch;let externalRequests=0,checks=0;
globalThis.fetch=(url,...args)=>{if(!String(url).startsWith(base)){externalRequests++;throw Error('External provider/collection calls prohibited');}return realFetch(url,...args);};
const post=async body=>{const response=await fetch(base+'/api/market-intelligence/analyses',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.ADMIN_TOKEN?{'x-admin-token':process.env.ADMIN_TOKEN}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
const counts=()=>Promise.all([db.productObservation.count(),db.shopObservation.count(),db.videoObservation.count(),db.creatorChannelObservation.count(),db.aiAnalysisReport.count(),db.aiUsageCounter.count()]);
function validate(pack){
 const ids=new Set(pack.evidence.map(e=>e.id));assert.equal(ids.size,pack.evidence.length);
 for(const e of pack.evidence){assert.ok(e.value===null||Number.isFinite(e.value));assert.ok(e.inputIds.every(id=>ids.has(id)));if(e.dataKind==='ESTIMATED')assert.ok(e.formula);}
 for(const chart of pack.charts){assert.ok(chart.evidenceIds.every(id=>ids.has(id)));assert.equal(chart.labels.length,chart.values.length);assert.ok(chart.values.every(v=>v===null||Number.isFinite(v)));}
 for(const r of pack.relations){assert.equal(r.status,'VERIFIED');assert.ok(r.evidenceIds.every(id=>ids.has(id)));}
 for(const section of Object.values(localResult(pack,'LOCAL').report.sections))for(const f of section.findings)assert.ok(f.evidenceIds.every(id=>ids.has(id)));
 checks++;
}
try {
 const before=await counts();
 assert.equal(growth(100,0),null);assert.equal(growth(100,null),null);assert.equal(growth(110,100),10);assert.equal(percentile(5,[1,2]),null);checks++;
 for(const bad of [{days:0},{days:'30'},{execution:'GEMINI'},{entityType:'VIDEO',entityId:'-1'},{compareIds:['abc']},{mode:'COMPARISON'},{entityType:'MARKET',entityId:'US'}]){assert.throws(()=>parseAnalysisRequest(bad));assert.equal((await post(bad)).status,400);}checks++;
 const mockRequest={execution:'MOCK',entityType:'MARKET',entityId:'VN'};
 // Hard fail if MOCK tries to acquire a database connection.
 const connect=pool.connect;pool.connect=()=>{throw Error('MOCK must not access PostgreSQL');};
 let mock;try{mock=await post(mockRequest);}finally{pool.connect=connect;}
 assert.equal(mock.status,200);assert.equal(mock.body.data.execution,'MOCK');assert.equal(mock.body.data.providerCalled,false);assert.equal(mock.body.data.persisted,false);assert.equal(mock.body.data.usage.providerRequests,0);
 assert.ok(mock.body.data.pack.evidence.every(e=>e.dataKind==='SIMULATED'&&e.value===null));validate(mock.body.data.pack);
 const req=parseAnalysisRequest(mockRequest).request;assert.equal(buildMockPack(req).fingerprint,buildMockPack(req).fingerprint);
 const product=await db.product.findFirst({where:{market:'VN'},orderBy:{id:'asc'},select:{id:true}});
 const shop=await db.shop.findFirst({where:{market:'VN'},orderBy:{id:'asc'},select:{id:true}});
 const creator=await db.creatorChannelObservation.findFirst({where:{observedAt:{not:null},followerCount:{not:null}},select:{channelId:true}});
 const video=await db.videoObservation.findFirst({where:{observedAt:{not:null},playCount:{not:null}},select:{videoId:true}});
 const category=await db.productCategory.findFirst({where:{isPrimary:true,verificationStatus:'VERIFIED'},select:{categoryId:true}});
 for(const [entityType,entityId] of [['PRODUCT',product.id],['SHOP',shop.id],['CREATOR',creator.channelId],['VIDEO',video.videoId],['CATEGORY',category.categoryId],['MARKET','VN']]){
  const started=Date.now();const response=await post({execution:'LOCAL',entityType,entityId:String(entityId),mode:'QUICK'});
  assert.equal(response.status,200,JSON.stringify(response.body));const result=response.body.data;validate(result.pack);
  assert.equal(result.status,'LOCAL_COMPLETE');assert.equal(result.usage.billable,false);assert.equal(result.pack.sourcePolicy.canSendToProvider,true);
  assert.equal(result.pack.opportunityScore,null);assert.ok(result.pack.evidence.every(e=>e.dataKind!=='SIMULATED'));
  if(['PRODUCT','SHOP'].includes(entityType))assert.ok(Object.values(result.pack.history).flat().length===0);
  if(entityType==='CREATOR'){assert.ok(Object.values(result.pack.history).flat().length>0);assert.ok(result.pack.evidence.find(e=>e.metric==='attributedSales').value===null);}
  if(entityType==='VIDEO')assert.ok(result.pack.missing.some(m=>m.includes('NO_PRODUCT_ATTRIBUTION')));
  console.log(JSON.stringify({entityType,ms:Date.now()-started,evidence:result.pack.evidence.length,chars:JSON.stringify(result.pack).length}));
 }
 const parsed=parseAnalysisRequest({entityType:'PRODUCT',entityId:String(product.id)}).request;
 const a=await buildEvidencePack(parsed),b=await buildEvidencePack(parsed);assert.equal(a.fingerprint,b.fingerprint);
 const changed=structuredClone(a);changed.evidence[0].value=(changed.evidence[0].value??0)+1;assert.notDeepEqual(changed.evidence,a.evidence);checks++;
  const caps=await fetch(base+'/api/market-intelligence/capabilities').then(r=>r.json());assert.equal(caps.data.providerCalls,false);assert.equal(caps.data.persistence,false);
   const aiHeaders={'Content-Type':'application/json'};
   if(process.env.ADMIN_TOKEN)aiHeaders['x-admin-token']=process.env.ADMIN_TOKEN;
   const ai=await fetch(base+'/api/market-intelligence/ai-analyses',{method:'POST',headers:aiHeaders,body:JSON.stringify({execution:'LOCAL',confirmProviderCall:true,entityType:'MARKET',entityId:'VN'})});
   const aiBody=await ai.json();
   // With Gemini off this is AI_UNAVAILABLE; with it on, the MARKET pack exceeds the input limit and must be rejected before any provider call.
   assert.ok(ai.status===503||ai.status===413,JSON.stringify(aiBody));
   assert.ok(['AI_UNAVAILABLE','AI_INPUT_TOO_LARGE'].includes(aiBody.error.code),JSON.stringify(aiBody));
  const noConsent=await fetch(base+'/api/market-intelligence/ai-analyses',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.ADMIN_TOKEN?{'x-admin-token':process.env.ADMIN_TOKEN}:{})},body:JSON.stringify({execution:'LOCAL'})});assert.equal(noConsent.status,400);
 assert.deepEqual(await counts(),before);assert.equal(externalRequests,0);
 console.log(JSON.stringify({result:'PASS',checks,externalRequests,databaseObservationOrAiWrites:0}));
}finally{globalThis.fetch=realFetch;await new Promise(resolve=>server.close(resolve));await db.$disconnect();await pool.end();}
