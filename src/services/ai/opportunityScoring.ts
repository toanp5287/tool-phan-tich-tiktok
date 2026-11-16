import type { Evidence, Score, Candidate } from './marketIntelligenceTypes.js';
export function percentile(value:number, peers:number[]):number|null {
 if(peers.length<10 || !Number.isFinite(value))return null;
 return Math.round(100*(peers.filter(p=>p<value).length+peers.filter(p=>p===value).length/2)/peers.length);
}
export function growth(current:number|null,previous:number|null):number|null {
 return current===null||previous===null||previous<=0?null:(current-previous)*100/previous;
}
export function stabilityFromIncrements(increments:number[]):number|null {
 if(increments.length<7)return null;
 const mean=increments.reduce((sum,value)=>sum+value,0)/increments.length;
 if(mean<=0)return null;
 const variance=increments.reduce((sum,value)=>sum+(value-mean)**2,0)/increments.length;
 const cv=Math.sqrt(variance)/mean;
 return Math.max(0,Math.min(100,100/(1+cv)));
}
export function scoreEvidence(evidence:Evidence[], demand:number|null=null):{scores:Score[];total:number|null;confidence:number} {
 const refs=(metric:string)=>evidence.filter(e=>e.metric===metric&&e.value!==null&&e.dataKind!=='SIMULATED').map(e=>e.id);
 const scores:Score[]=[
  {criterion:'Demand Signals',value:demand,weight:.30,state:demand===null?'NO_DATA':'OK',formula:'Midrank percentile of cumulative reported units within same primary category/currency; n >= 10; not period demand',evidenceIds:refs('soldCount')},
  {criterion:'Growth Signals',value:null,weight:.25,state:'INSUFFICIENT_HISTORY',formula:'Comparable dated sales cohort and positive baseline required; no proxy from views',evidenceIds:[]},
  {criterion:'Competition',value:null,weight:.20,state:'NOT_SUPPORTED',formula:'Observed links are lower bounds, not total market competition; no advantage score without coverage',evidenceIds:[]},
  {criterion:'Creator Activity',value:null,weight:.15,state:'NOT_SUPPORTED',formula:'Verified product promotion links and dated posts required for opportunity scoring',evidenceIds:[]},
  {criterion:'Stability',value:null,weight:.10,state:'INSUFFICIENT_HISTORY',formula:'100/(1+population CV) on >= 7 dated comparable sales increments; not cumulative totals',evidenceIds:[]},
  {criterion:'Market Saturation',value:null,weight:0,state:'NOT_SUPPORTED',formula:'Requires representative market coverage; entity counts alone are insufficient',evidenceIds:[]},
  {criterion:'Price Position',value:null,weight:0,state:'NO_DATA',formula:'Price percentile in category/currency cohort; descriptive, not automatically opportunity advantage',evidenceIds:[]},
  {criterion:'Content Momentum',value:null,weight:0,state:'INSUFFICIENT_HISTORY',formula:'Matched-post dated view changes; not sales or attribution',evidenceIds:[]},
 ];
 const facts=evidence.filter(e=>e.dataKind!=='SIMULATED');
 // Confidence measures evidence completeness/provenance, not commercial success.
 const confidence=facts.length?Math.round(100*(.4*facts.filter(e=>e.value!==null).length/facts.length+.3*facts.filter(e=>e.recordIds.length&&e.source).length/facts.length+.2*facts.filter(e=>e.observedAt).length/facts.length+.1*facts.filter(e=>e.dataKind==='VERIFIED').length/facts.length)):0;
 const required=scores.filter(s=>s.weight>0);
 return {scores,total:required.every(s=>s.value!==null)?Math.round(required.reduce((n,s)=>n+s.value!*s.weight,0)):null,confidence};
}
export function researchCandidates(evidence:Evidence[],names:Record<string,string>):Candidate[] {
 return evidence.filter(e=>e.metric==='demandPercentile'&&e.value!==null&&e.value>=75&&e.dataKind==='ESTIMATED').slice(0,5).map(e=>({id:'candidate-'+e.id,type:'PRODUCT',entityKey:e.entityId,title:names[e.entityId]??e.entityId,priority:'LOW',score:null,confidence:Math.min(50,scoreEvidence(evidence.filter(f=>f.entityId===e.entityId)).confidence),evidenceIds:[e.id,...e.inputIds],limitations:['Research lead only, not a proven business opportunity','Cumulative sample sales, no dated commerce growth or margin data'],nextAction:'Xác minh giá nhập, biên lợi nhuận, quyền nguồn và doanh số theo kỳ trước khi thử nghiệm.'}));
}
export function scoreMarketGap(input:{demandLevel:number|null;growthRate:number|null;competitionAdvantage:number|null;stability:number|null;productCoverage:number|null}):{scores:Score[];total:number|null;missing:string[];scoredCriteria:string[];isFull:boolean} {
 const clamp=(value:number)=>Math.max(0,Math.min(100,value));
 const growthScore=input.growthRate===null?null:clamp(50+input.growthRate/2);
 const entries:[string,number|null,number,string][]=[
  ['Nhu cầu thị trường',input.demandLevel,.25,'Percentile của giá trị bán ước tính của ngách so với các ngách cùng danh mục và tiền tệ; cohort ≥ 10 ngách hợp lệ'],
  ['Tăng trưởng',growthScore,.25,'clamp(50 + tốc độ tăng trưởng % / 2, 0, 100); cần ≥ 2 mốc quan sát mỗi kỳ và kỳ trước > 0'],
  ['Lợi thế cạnh tranh',input.competitionAdvantage,.25,'100 × (1 − tỷ trọng giá trị bán của shop lớn nhất); chỉ tính khi tỷ lệ liên kết shop ≥ 60%'],
  ['Độ ổn định',input.stability,.15,'100 / (1 + hệ số biến thiên) trên ít nhất 7 mức tăng hợp lệ theo ngày'],
  ['Độ phủ sản phẩm',input.productCoverage===null?null:clamp(input.productCoverage*100),.10,'100 × sản phẩm có hoạt động bán / sản phẩm có dữ liệu bán'],
 ];
  const scores:Score[]=entries.map(([criterion,value,weight,formula])=>({criterion,value,weight,state:value===null?(criterion==='Tăng trưởng'||criterion==='Độ ổn định'?'INSUFFICIENT_HISTORY':'INSUFFICIENT_DATA'):'AVAILABLE',formula,evidenceIds:[]}));
  const missing=scores.filter(score=>score.value===null).map(score=>score.criterion);
  const available=scores.filter(score=>score.value!==null);
  const totalWeight=available.reduce((sum,score)=>sum+score.weight,0);
  return {scores,total:totalWeight?Math.round(available.reduce((sum,score)=>sum+score.value!*score.weight,0)/totalWeight):null,missing,scoredCriteria:available.map(score=>score.criterion),isFull:missing.length===0};
}
