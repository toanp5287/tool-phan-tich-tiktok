import { createHash } from 'node:crypto';
import { datasetDb as db } from '../../config/datasetDb.js';
import { AppError } from '../../utils/errors.js';
import { datasetDay, estimatedGmv, sumNumbers } from '../analytics.js';
import { readMetricSeries } from '../snapshotService.js';
import { percentile, scoreEvidence, researchCandidates, growth } from './opportunityScoring.js';
import type { AnalysisRequest, Evidence, EvidencePack, EntityType, Relation, ChartSpec, State } from './marketIntelligenceTypes.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const numeric=(v:unknown):number|null=>{if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null;};
const sourceInclude={record:{include:{file:{include:{source:true}}}}};
const observationOrder=[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}];
type Observation={id:bigint;rawRecordId:bigint;observedAt:Date|null;record:{file:{sha256:string;source:{code:string;usageRestriction:string}}}};
export async function buildEvidencePack(request:AnalysisRequest):Promise<EvidencePack>{
 const limit=request.mode==='QUICK'?10:request.mode==='DEEP'?40:25;
 const evidence:Evidence[]=[],relations:Relation[]=[],charts:ChartSpec[]=[],history:EvidencePack['history']={};
 const names:Record<string,string>={},missing=new Set<string>(),limitations=new Set<string>();
 let available=0,selected=0;
 const peerCache=new Map<string,Awaited<ReturnType<typeof peerSample>>>();
 async function peerSample(categoryId:number,currency:string){return db.product.findMany({where:{currency,categories:{some:{categoryId,isPrimary:true,verificationStatus:'VERIFIED'}}},orderBy:{id:'asc'},take:50,select:{id:true,observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1,include:sourceInclude}}});}
 const key=(type:EntityType,id:string|number)=>`${type}:${id}`;
 const add=(type:EntityType,id:string|number,metric:string,value:number|null,unit:string,o?:Observation,currency:string|null=null,formula:string|null=null,inputIds:string[]=[],notes:string[]=[]):Evidence=>{
  const entityId=key(type,id),date=o?.observedAt?.toISOString()??null;
  const e:Evidence={id:'ev-'+hash([entityId,metric,o?.id.toString()??'',formula,inputIds]).slice(0,20),entityId,entityType:type,metric,value,unit,currency,dataKind:value!==null&&formula?'ESTIMATED':'UNKNOWN',state:value===null?'NO_DATA':date?'OK':'NO_TIMESTAMP',observedAt:date,source:o?.record.file.source.code??null,usageRestriction:o?.record.file.source.usageRestriction??'UNKNOWN',recordIds:o?[o.rawRecordId.toString()]:[],fileHashes:o?[o.record.file.sha256]:[],formula,inputIds,limitations:notes};
  if(formula){const inputs=evidence.filter(item=>inputIds.includes(item.id));e.recordIds=[...new Set(inputs.flatMap(i=>i.recordIds))];e.fileHashes=[...new Set(inputs.flatMap(i=>i.fileHashes))];e.source=[...new Set(inputs.map(i=>i.source).filter(Boolean))].join(',')||null;e.usageRestriction=inputs.length>0&&inputs.every(i=>i.usageRestriction==='COMMERCIAL_ALLOWED')?'COMMERCIAL_ALLOWED':'UNKNOWN';}
  if(!evidence.some(item=>item.id===e.id))evidence.push(e);
  return e;
 };
 const relation=(from:string,to:string,type:string,status:string,records:{rawRecordId:bigint}[]=[],derived=false)=>{
  if(status!=='VERIFIED')return;
  const id='rel-'+hash([from,to,type]).slice(0,20);
  const ev:Evidence={id:'ev-'+id,entityId:from,entityType:from.split(':')[0] as EntityType,metric:type,value:null,unit:'relation',currency:null,dataKind:'VERIFIED',state:'OK',observedAt:null,source:'DATABASE_RELATION',usageRestriction:'UNKNOWN',recordIds:records.map(r=>r.rawRecordId.toString()),fileHashes:[],formula:derived?'Verified path through product links':null,inputIds:[],limitations:['Relationship verification does not verify commercial attribution or source reuse rights']};
  if(!relations.some(r=>r.id===id)){evidence.push(ev);relations.push({id,from,to,type,status,evidenceIds:[ev.id],derived});}
 };
 const dated=(type:EntityType,id:number,metric:string,field:string,rows:(Observation&Record<string,unknown>)[])=>{
  const daily=new Map<string,Observation&Record<string,unknown>>();
  for(const row of [...rows].filter(r=>r.observedAt).sort((a,b)=>a.observedAt!.getTime()-b.observedAt!.getTime()||(a.id<b.id?-1:a.id>b.id?1:0)))daily.set(datasetDay(row.observedAt!),row);
  const days=[...daily.keys()].sort(),anchor=days.at(-1);
  const start=anchor?Date.parse(anchor+'T00:00:00Z')-(request.days-1)*86400000:0;
  const points=[...daily].filter(([date])=>Date.parse(date+'T00:00:00Z')>=start).sort(([a],[b])=>a.localeCompare(b)).map(([date,o])=>{const e=add(type,id,metric,numeric(o[field]),'count',o);return {date,value:e.value,evidenceId:e.id};});
  const seriesKey=key(type,id)+':'+metric;history[seriesKey]=points;
  const usable=points.filter(p=>p.value!==null).length;
  const state:State=points.length===0?(rows.length?'NO_TIMESTAMP':'NO_DATA'):usable===0?'NO_DATA':usable===1?'SINGLE_POINT':'OK';
  if(state!=='OK')missing.add(seriesKey+':'+state);
  charts.push({id:'chart-'+hash(seriesKey).slice(0,12),type:'line',title:`${names[key(type,id)]??id} · ${metric} tích lũy`,unit:'count',period:points.length?`${points[0]!.date} → ${points.at(-1)!.date}`:'Không có timestamp',dataKind:'UNKNOWN',state,labels:points.map(p=>p.date),values:points.map(p=>p.value),evidenceIds:points.map(p=>p.evidenceId)});
  const valid=points.filter(p=>p.value!==null),first=valid[0],last=valid.at(-1);
  if(first&&last&&first!==last&&first.value!>0){
   add(type,id,metric+'ObservedChangePercent',growth(last.value,first.value),'%',undefined,null,'(last - first) / first × 100',[first.evidenceId,last.evidenceId],['Change between dated observations, not full-window growth, sales or causal impact']);
  }
 };
 /** Read a MetricSnapshot series (product/shop) and surface it as dated history + chart. */
 const datedSnapshots=async(type:EntityType,id:number,metric:string,unit:string,isEstimate=false)=>{
  const series=await readMetricSeries(type,id,metric);
  if(series.length===0)return;
  const points=series.map(p=>({date:p.date,value:p.value}));
  const seriesKey=key(type,id)+':'+metric+':snapshot';
  history[seriesKey]=points.map(p=>({date:p.date,value:p.value,evidenceId:''}));
  const usable=points.filter(p=>p.value!==null).length;
  const state:State=usable===0?'NO_DATA':usable===1?'SINGLE_POINT':'OK';
  charts.push({id:'chart-'+hash(seriesKey).slice(0,12),type:'line',title:`${names[key(type,id)]??id} · ${metric} (snapshot)`,unit,period:points.length?`${points[0]!.date} → ${points.at(-1)!.date}`:'Không có timestamp',dataKind:isEstimate?'ESTIMATED':'VERIFIED',state,labels:points.map(p=>p.date),values:points.map(p=>p.value),evidenceIds:[]});
 };
 let entityName='Thị trường trong mẫu dữ liệu',categoryId:number|undefined;
 const id=Number(request.entityId);
 if(request.entityType==='PRODUCT'){const p=await db.product.findUnique({where:{id},select:{title:true}});if(!p)throw AppError.notFound('Không tìm thấy sản phẩm');entityName=p.title;}
 if(request.entityType==='SHOP'){const p=await db.shop.findUnique({where:{id},select:{name:true}});if(!p)throw AppError.notFound('Không tìm thấy shop');entityName=p.name;}
 if(request.entityType==='CREATOR'){const p=await db.creatorChannel.findUnique({where:{id},select:{displayName:true,username:true,platform:true}});if(!p)throw AppError.notFound('Không tìm thấy channel Creator');entityName=p.displayName??p.username??request.entityId;}
 if(request.entityType==='VIDEO'){const p=await db.video.findUnique({where:{id},select:{caption:true}});if(!p)throw AppError.notFound('Không tìm thấy video');entityName=p.caption??request.entityId;}
 if(request.entityType==='CATEGORY'){const p=await db.category.findFirst({where:/^[0-9]+$/.test(request.entityId)?{id}:{OR:[{slug:request.entityId},{name:request.entityId}]},select:{id:true,name:true}});if(!p)throw AppError.notFound('Không tìm thấy category');categoryId=p.id;entityName=p.name;}
 names[key(request.entityType,request.entityId)]=entityName;
 const ids=[id,...request.compareIds.map(Number)].filter(Number.isSafeInteger);
 const productWhere=request.entityType==='PRODUCT'?{id:{in:ids}}:request.entityType==='SHOP'?{shops:{some:{shopId:{in:ids},verificationStatus:'VERIFIED' as const,isActive:true}}}:request.entityType==='CATEGORY'?{categories:{some:{categoryId,isPrimary:true,verificationStatus:'VERIFIED' as const}}}:request.entityType==='MARKET'?{market:'VN'}:{id:{in:[] as number[]}};
 const productTotal=await db.product.count({where:productWhere});
 const products=await db.product.findMany({where:productWhere,orderBy:{id:'asc'},take:limit,include:{observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1,include:sourceInclude},shops:{where:{verificationStatus:'VERIFIED',isActive:true},take:20,include:{shop:true,evidence:{take:5}}},categories:{where:{isPrimary:true},take:1,include:{category:true,evidence:{take:5}}},creators:{where:{verificationStatus:'VERIFIED'},take:20,include:{creator:true,evidence:{take:5}}},videos:{where:{verificationStatus:'VERIFIED'},take:20,include:{video:true,evidence:{take:5}}}}});
 available+=productTotal;selected+=products.length;
 const sampleMetrics:{name:string;gmv:Evidence;sold:Evidence;currency:string|null}[]=[];
 for(const p of products){
  const k=key('PRODUCT',p.id);names[k]=p.title;const o=p.observations[0];
  const sold=add('PRODUCT',p.id,'soldCount',numeric(o?.soldCount),'reported cumulative units',o);
  const price=add('PRODUCT',p.id,'price',numeric(o?.price),'currency',o,p.currency);
  const sameCurrency=!!p.currency&&o?.currency===p.currency;
  const gmv=add('PRODUCT',p.id,'estimatedCumulativeGmv',sameCurrency?estimatedGmv(sold.value,price.value):null,'currency',undefined,p.currency,'soldCount × latest same-currency observation price',[sold.id,price.id],['Not verified revenue; no dated period, returns, discounts or margin','Product-wide sales cannot be attributed to individual shops']);
  sampleMetrics.push({name:p.title,gmv,sold,currency:p.currency});
  add('PRODUCT',p.id,'knownLinkedShops',p.shops.length,'lower-bound count',undefined,null,'Count verified active ProductShop links',[],['Bounded sample, not total sellers in market']);
  for(const link of p.shops){names[key('SHOP',link.shopId)]=link.shop.name;relation(k,key('SHOP',link.shopId),'PRODUCT_SOLD_BY_SHOP',link.verificationStatus,link.evidence);}
  for(const c of p.categories){names[key('CATEGORY',c.categoryId)]=c.category.name;relation(k,key('CATEGORY',c.categoryId),'PRIMARY_CATEGORY',c.verificationStatus,c.evidence);for(const shop of p.shops)relation(key('CATEGORY',c.categoryId),key('SHOP',shop.shopId),'CATEGORY_SHOP_VIA_PRODUCT',c.verificationStatus,[...c.evidence,...shop.evidence],true);}
  for(const link of p.creators){names[key('CREATOR',link.creatorId)]=link.creator.displayName;relation(k,key('CREATOR',link.creatorId),'PRODUCT_CREATOR_IDENTITY',link.verificationStatus,link.evidence);}
  for(const link of p.videos){names[key('VIDEO',link.videoId)]=link.video.caption??String(link.videoId);relation(k,key('VIDEO',link.videoId),'PRODUCT_VIDEO',link.verificationStatus,link.evidence);}
  if(!o?.observedAt)missing.add(k+':NO_TIMESTAMP');
  const cat=p.categories[0];
  if(cat&&p.currency&&sold.value!==null){
   const cohort=cat.categoryId+':'+p.currency;
   let peerRows=peerCache.get(cohort);if(!peerRows){peerRows=await peerSample(cat.categoryId,p.currency);peerCache.set(cohort,peerRows);}
   const peerIds:string[]=[],values:number[]=[];
   for(const peer of peerRows){const obs=peer.observations[0];const v=numeric(obs?.soldCount);if(v!==null){values.push(v);peerIds.push(add('PRODUCT',peer.id,'peerSoldCount',v,'reported cumulative units',obs).id);}}
   const rank=percentile(sold.value,values);
   add('PRODUCT',p.id,'demandPercentile',rank,'percentile',undefined,null,'100 × (count below + 0.5 × count equal) / eligible same-category same-currency sample; n >= 10',[sold.id,...peerIds],['Peer sample capped at 50; cumulative sales are not current demand or full market share']);
  }
 }
 // Shop profile values are independent of product-wide sales; no invented allocation.
 const shopWhere=request.entityType==='SHOP'?{id:{in:ids}}:request.entityType==='MARKET'?{market:'VN'}:request.entityType==='CATEGORY'?{products:{some:{verificationStatus:'VERIFIED' as const,product:{categories:{some:{categoryId,isPrimary:true}}}}}}:{id:{in:[] as number[]}};
 available+=await db.shop.count({where:shopWhere});
 const shops=await db.shop.findMany({where:shopWhere,orderBy:{id:'asc'},take:limit,include:{observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1,include:sourceInclude},_count:{select:{products:true}},creators:{where:{verificationStatus:'VERIFIED'},take:20,include:{creator:true,evidence:{take:5}}}}});
 selected+=shops.length;
 for(const s of shops){names[key('SHOP',s.id)]=s.name;const o=s.observations[0];add('SHOP',s.id,'followers',numeric(o?.followerCount),'count',o);add('SHOP',s.id,'reportedProductCount',numeric(o?.productCount),'count',o);add('SHOP',s.id,'knownProductLinks',s._count.products,'count');add('SHOP',s.id,'attributedGmv',null,'currency',undefined,'VND',null,[],['No shop-attributed verified revenue in dataset']);for(const link of s.creators){names[key('CREATOR',link.creatorId)]=link.creator.displayName;relation(key('SHOP',s.id),key('CREATOR',link.creatorId),'SHOP_CREATOR',link.verificationStatus,link.evidence);}}
 const channelWhere=request.entityType==='CREATOR'?{id:{in:ids}}:request.entityType==='MARKET'?{market:'VN',platform:'tiktok'}:request.entityType==='CATEGORY'?{categories:{some:{categoryId,verificationStatus:'VERIFIED' as const}}}:{id:{in:[] as number[]}};
 available+=await db.creatorChannel.count({where:channelWhere});
 const channels=await db.creatorChannel.findMany({where:channelWhere,orderBy:{id:'asc'},take:request.entityType==='CREATOR'?5:limit,include:{observations:{where:{observedAt:{not:null}},orderBy:observationOrder,take:150,include:sourceInclude},_count:{select:{videos:true}},categories:{where:{verificationStatus:'VERIFIED'},take:20,include:{category:true,evidence:{take:5}}}}});
 selected+=channels.length;
 for(const c of channels){names[key('CREATOR',c.id)]=c.displayName??c.username??String(c.id);dated('CREATOR',c.id,'followers','followerCount',c.observations as (Observation&Record<string,unknown>)[]);add('CREATOR',c.id,'videoCount',c._count.videos,'count');add('CREATOR',c.id,'attributedSales',null,'units',undefined,null,null,[],['No sales attribution; views and likes are not orders']);for(const link of c.categories){names[key('CATEGORY',link.categoryId)]=link.category.name;relation(key('CREATOR',c.id),key('CATEGORY',link.categoryId),'CREATOR_CATEGORY',link.verificationStatus,link.evidence);}if(c.observations.length===150)limitations.add('Channel observations capped at 150; history may be truncated');}
 const videoWhere=request.entityType==='VIDEO'?{id:{in:ids}}:request.entityType==='CREATOR'?{channelId:{in:ids}}:request.entityType==='PRODUCT'?{products:{some:{productId:{in:ids},verificationStatus:'VERIFIED' as const}}}:request.entityType==='CATEGORY'?{categories:{some:{categoryId,verificationStatus:'VERIFIED' as const}}}:request.entityType==='MARKET'?{market:'VN'}:{id:{in:[] as number[]}};
 available+=await db.video.count({where:videoWhere});
 const videos=await db.video.findMany({where:videoWhere,orderBy:{id:'asc'},take:limit,include:{channel:true,observations:{orderBy:observationOrder,take:20,include:sourceInclude},products:{where:{verificationStatus:'VERIFIED'},take:20,include:{evidence:{take:5}}}}});
 selected+=videos.length;
 for(const v of videos){
  names[key('VIDEO',v.id)]=(v.caption??String(v.id)).slice(0,120);
  dated('VIDEO',v.id,'views','playCount',v.observations as (Observation&Record<string,unknown>)[]);
  const o=v.observations.find(o=>o.observedAt)??v.observations[0];
  const views=add('VIDEO',v.id,'currentViews',numeric(o?.playCount),'cumulative views',o);
  const interactions=['diggCount','shareCount','commentCount'].map(field=>add('VIDEO',v.id,field,numeric(o?.[field as 'diggCount']),'count',o));
  const all=interactions.every(e=>e.value!==null);
  add('VIDEO',v.id,'engagementRate',views.value!==null&&views.value>0&&all?sumNumbers(interactions.map(e=>e.value))!*100/views.value:null,'%',undefined,null,'100 × (likes + shares + comments) / views',[views.id,...interactions.map(e=>e.id)],['Metadata only; no visual/audio understanding; not commercial conversion']);
  if(v.channel){names[key('CREATOR',v.channelId!)]=v.channel.displayName??v.channel.username??String(v.channelId);relation(key('CREATOR',v.channelId!),key('VIDEO',v.id),'CHANNEL_POSTED_VIDEO','VERIFIED',o?[{rawRecordId:o.rawRecordId}]:[]);}
  for(const link of v.products)relation(key('VIDEO',v.id),key('PRODUCT',link.productId),'VIDEO_PRODUCT',link.verificationStatus,link.evidence);
  if(!v.products.length)missing.add(key('VIDEO',v.id)+':NO_PRODUCT_ATTRIBUTION');
 }
 for(const currency of [...new Set(sampleMetrics.map(m=>m.currency).filter((s):s is string=>!!s))]){const sample=sampleMetrics.filter(m=>m.currency===currency);charts.push({id:'products-'+currency,type:'bar',title:'Ước tính lũy kế trong mẫu sản phẩm · '+currency,unit:currency,period:'Không có kỳ bán hàng xác minh',dataKind:'ESTIMATED',state:sample.some(m=>m.gmv.value!==null)?'OK':'NO_DATA',labels:sample.map(m=>m.name),values:sample.map(m=>m.gmv.value),evidenceIds:sample.map(m=>m.gmv.id)});}
 const categories=new Map<string,{name:string;count:number;refs:string[]}>();
 for(const p of products){const cat=p.categories[0];if(!cat||cat.verificationStatus!=='VERIFIED')continue;const current=categories.get(cat.category.name)??{name:cat.category.name,count:0,refs:[]};current.count++;const count=add('PRODUCT',p.id,'classifiedProduct',1,'product',p.observations[0]);current.refs.push(count.id);categories.set(cat.category.name,current);}
 if(categories.size){const entries=[...categories.values()];charts.push({id:'category-composition',type:'doughnut',title:'Phân bố sản phẩm được chọn, không phải thị phần',unit:'products',period:'Snapshot không có timestamp',dataKind:'ESTIMATED',state:'OK',labels:entries.map(e=>e.name),values:entries.map(e=>e.count),evidenceIds:entries.flatMap(e=>e.refs)});}
 charts.push({id:'relationships',type:'relationship',title:'Quan hệ có bằng chứng trong mẫu',unit:'edges',period:'Quan hệ hiện có trong database',dataKind:'VERIFIED',state:relations.length?'OK':'NO_DATA',labels:[],values:[],evidenceIds:relations.flatMap(r=>r.evidenceIds),nodes:[...new Set(relations.flatMap(r=>[r.from,r.to]))].map(id=>({id,label:names[id]??id})),edges:relations.map(r=>({from:r.from,to:r.to,evidenceId:r.evidenceIds[0]!}))});
 const subjectEvidence=request.entityType==='MARKET'||request.entityType==='CATEGORY'?evidence:evidence.filter(e=>e.entityId===key(request.entityType,request.entityId));
 const scored=scoreEvidence(subjectEvidence,subjectEvidence.find(e=>e.metric==='demandPercentile')?.value??null);
 const dates=evidence.map(e=>e.observedAt).filter((d):d is string=>!!d).sort(),asOf=dates.at(-1)??null;
 const stale=!!asOf&&Date.now()-Date.parse(asOf)>30*86400000;
 if(stale)limitations.add('STALE_DATA: latest dated evidence is older than 30 days; not current market intelligence');
 limitations.add('Dataset sample is not representative of the entire TikTok market');
 limitations.add('Product-wide cumulative units cannot establish shop/creator attribution or period revenue');
 limitations.add('History is anchored to each selected entity latest observation; compare dates before comparing entities');
 limitations.add('Bounded history: latest 150 channel observations and latest 20 video observations, not guaranteed full-window coverage');
 if(!relations.some(r=>r.type==='PRODUCT_CREATOR_IDENTITY'))missing.add('NO_VERIFIED_PRODUCT_CREATOR_RELATIONS_IN_SAMPLE');
 if(!relations.some(r=>r.type==='VIDEO_PRODUCT'||r.type==='PRODUCT_VIDEO'))missing.add('NO_VERIFIED_PRODUCT_VIDEO_RELATIONS_IN_SAMPLE');
 if(selected<available)limitations.add('Bounded deterministic ID-ordered sample, not a market ranking; inspect sample counts');
 // Source metadata remains informational; transmission is the project owner's configuration choice.
 const blockedSources:string[]=[];
 const {force:_,...scopeRequest}=request;
 const pack:EvidencePack={version:'mi-evidence-v1',scoringVersion:'mi-score-v1',reportVersion:'mi-report-v1',fingerprint:'',request:scopeRequest,entity:{id:request.entityId,type:request.entityType,name:entityName},scope:'Dataset v2 · selected same-currency samples only',asOf,preparedAt:new Date().toISOString(),stale,evidence,history,relations,charts,scores:scored.scores,opportunityScore:scored.total,evidenceConfidence:scored.confidence,candidates:researchCandidates(evidence,names),missing:[...missing],limitations:[...limitations,'Provider transmission permitted by project configuration; source reuse rights are not certified'],sourcePolicy:{canSendToProvider:true,blockedSources},sample:{selected,available,truncated:selected<available}};
 if(evidence.length>3500||JSON.stringify(pack).length>2500000)throw new AppError('Phạm vi Evidence Pack quá lớn. Chọn QUICK hoặc một thực thể cụ thể.',413,'EVIDENCE_PACK_TOO_LARGE');
 pack.fingerprint=hash({...pack,preparedAt:undefined,fingerprint:undefined});
 return pack;
}
