import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';
import { datasetDb as db, datasetPool as pool } from '../dist/config/datasetDb.js';

const target=await db.productCategory.findFirst({where:{isPrimary:true,verificationStatus:'VERIFIED',product:{market:'VN',currency:'VND'}},select:{categoryId:true,subCategoryId:true}});
if(!target)throw Error('Missing verified VND category fixture');
const server=createApp().listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
const post=async body=>{const response=await fetch(base+'/api/market-intelligence/market-gaps/analyses',{method:'POST',headers:{'Content-Type':'application/json',...(process.env.ADMIN_TOKEN?{'x-admin-token':process.env.ADMIN_TOKEN}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
try{
 for(const body of [{},{categoryId:target.categoryId,currency:'VND',days:14},{categoryId:target.categoryId,currency:'',days:30}])assert.equal((await post(body)).status,400);
 const request={categoryId:target.categoryId,currency:'VND',days:30,mode:'QUICK'};
  const first=await post(request);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.data.execution,'LOCAL');assert.equal(first.body.data.providerCalled,false);assert.equal(first.body.data.result.scoringVersion,'mi-score-v4');assert.ok(Array.isArray(first.body.data.result.niches));
 const second=await post(request);assert.equal(second.status,200);if(first.body.data.persisted){assert.equal(second.body.data.cache.hit,true);assert.equal(second.body.data.analysisId,first.body.data.analysisId);}
  assert.ok(first.body.data.analysisId,'A non-empty preliminary result must be persisted for stable detail IDs');
  {const saved=await fetch(base+'/api/market-intelligence/market-gaps/analyses/'+first.body.data.analysisId).then(response=>response.json());assert.equal(saved.success,true);assert.equal(saved.data.result.scoringVersion,'mi-score-v4');}
 if(first.body.data.result.niches.length>0){
  const key=first.body.data.result.niches[0].key;
  const detail=await fetch(base+`/api/market-intelligence/market-gaps/analyses/${first.body.data.analysisId}/niches/${key}`).then(response=>response.json());
  assert.equal(detail.success,true);assert.ok(Array.isArray(detail.data.topProducts));assert.ok(Array.isArray(detail.data.topShops));
 }
  const emptyCategory=await db.category.findFirst({where:{name:'Mẹ & Bé'},select:{id:true}});
  if(emptyCategory){const empty=await post({categoryId:emptyCategory.id,subCategoryId:1000000112,currency:'VND',days:90,mode:'DEEP'});assert.equal(empty.status,200,JSON.stringify(empty.body));assert.equal(empty.body.data.cache.hit,false);assert.equal(empty.body.data.persisted,false);assert.equal(empty.body.data.result.nicheCount,0);assert.equal(empty.body.data.result.diagnostics.emptyReason,'NO_REQUESTED_CURRENCY_PRODUCTS');}
 console.log(JSON.stringify({result:'PASS',analysisId:first.body.data.analysisId}));
}finally{await new Promise(resolve=>server.close(resolve));await db.$disconnect();await pool.end();}
