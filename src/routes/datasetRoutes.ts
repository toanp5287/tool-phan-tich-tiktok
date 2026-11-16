import { Router, type Request, type Response } from 'express';
import { datasetDb as db, verifyDatasetDatabase } from '../config/datasetDb.js';
import * as service from '../services/datasetService.js';
import { asyncHandler, sendSuccess } from '../utils/http.js';
import { AppError, isAppError } from '../utils/errors.js';
import { sumNumbers, scalarAnalytics, METHOD_ESTIMATED_GMV } from '../services/analytics.js';
import { parseMode, marketGrowth, competition, affiliateContribution, shopPerformance, creatorPerformance } from '../services/analyticsService.js';
import {createProductAnalysisV2} from '../services/ai/productAnalysisV2.js';
import {createProductDeepAnalysis, getProductDeepAnalysis, listProductDeepAnalyses} from '../services/ai/productDeepAnalysis.js';
import {findWinningProducts} from '../services/ai/winningProductFinder.js';
import {askProductFollowUp} from '../services/ai/conversationService.js';
import {serializeProductReport} from '../services/ai/productReportCompatibility.js';
import {categoryDisplayName, subCategoryDisplayName} from '../config/taxonomyDisplayNames.js';
const router=Router();
router.use((req,_res,next)=>{
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&process.env.ADMIN_TOKEN&&req.get('x-admin-token')!==process.env.ADMIN_TOKEN)return next(AppError.unauthorized('Token quản trị không hợp lệ'));
 next();
});
const q=(req:Request)=>req.query as Record<string,unknown>;
const id=(value:unknown)=>{const s=String(value);const n=Number(s);if(!/^[1-9][0-9]*$/.test(s)||!Number.isSafeInteger(n)||n>2147483647)throw AppError.badRequest('ID không hợp lệ');return n;};
const get=(path:string,fn:(req:Request)=>Promise<unknown>)=>router.get(path,asyncHandler(async(req,res)=>{sendSuccess(res,await fn(req));}));
const post=(path:string,fn:(req:Request)=>Promise<unknown>)=>router.post(path,asyncHandler(async(req,res)=>{
 try{sendSuccess(res,await fn(req));}
 catch(error){
  if(isAppError(error)&&error.statusCode===429&&error.details&&typeof error.details==='object'){
   const retryAfter=(error.details as {retryAfterSeconds?:unknown}).retryAfterSeconds;
   if(typeof retryAfter==='number'&&Number.isFinite(retryAfter))res.setHeader('Retry-After',String(Math.max(1,Math.ceil(retryAfter))));
  }
  throw error;
 }
}));
const list=(path:string,fn:(req:Request)=>Promise<{items:unknown[];pagination:unknown}>)=>router.get(path,asyncHandler(async(req,res)=>{const r=await fn(req);res.json({success:true,data:r.items,pagination:r.pagination,meta:{database:'DATASET_V2',legacyFallback:false,analyticsScope:'PER_ITEM'}});}));
const blocked=(_req:Request,_res:Response)=>{throw new AppError('Thu thập ngoài đang tắt trong chế độ dataset offline. Không phát sinh request hoặc chi phí.',503,'EXTERNAL_COLLECTION_DISABLED');};
get('/health',async()=>{await verifyDatasetDatabase();return {status:'ok',database:'tiktok_datasets_v2',generation:2,legacyFallback:false,externalActionsEnabled:false};});
for(const base of ['', '/commerce']) {
 const commerce=base==='/commerce';
 get(base+'/overview',req=>service.overview(q(req),commerce));
 if(!commerce)get('/analytics',req=>service.overview(q(req)));
 list(base+'/products',req=>service.products(q(req),commerce));
 if(!commerce)get('/products/compare',async req=>Promise.all(String(req.query.ids??'').split(',').filter(Boolean).slice(0,5).map(x=>service.productDetail(id(x)))));
  get(base+'/products/:id',req=>service.productDetail(id(req.params.id),commerce,service.rangeMeta(q(req)).days,parseMode(req.query.mode)));
  list(base+'/products/:id/creators',req=>service.productCreators(id(req.params.id),q(req)));
  list(base+'/products/:id/videos',req=>service.productVideos(id(req.params.id),q(req)));
  list(base+'/shops',req=>service.shops(q(req),commerce));
  get(base+'/shops/:id',req=>service.shopDetail(id(req.params.id),commerce,service.rangeMeta(q(req)).days));
  list(base+'/shops/:id/products',req=>service.shopProducts(id(req.params.id),q(req),commerce));
  list(base+'/shops/:id/creators',req=>service.shopCreators(id(req.params.id),q(req),commerce));
  get(base+'/shops/:id/videos',async req=>(await service.shopDetail(id(req.params.id),commerce,service.rangeMeta(q(req)).days)).topTrendVideos);
  list(base+'/creators',req=>service.creators(q(req),commerce));
 if(!commerce)get('/creators/top',async req=>(await service.creators({...q(req),pageSize:req.query.limit??10})).items);
   get(base+'/creators/:id',req=>service.creatorDetail(id(req.params.id),commerce,q(req)));
   list(base+'/creators/:id/products',req=>service.creatorProducts(id(req.params.id),q(req),commerce));
   list(base+'/creators/:id/shops',req=>service.creatorShops(id(req.params.id),q(req),commerce));
  get(base+'/categories',async()=>{const rows=await service.categories(commerce);const totalGmv=sumNumbers(rows.map(c=>c.totalGmv));const totalSales=sumNumbers(rows.map(c=>c.totalSales));const categories=rows.map(category=>({ ...category,displayName:categoryDisplayName(category.name,category.slug),subCategories:category.subCategories.map(sub=>({...sub,displayName:subCategoryDisplayName(sub.name,sub.slug)})),shareOfGmv:totalGmv&&category.totalGmv!==null?category.totalGmv*100/totalGmv:null }));const products=(await service.loadProducts()).map(service.productCard).filter(p=>(!commerce||p.region==='VN')&&p.category!==null);return {categories,overview:{categoryCount:categories.length,totalProducts:categories.reduce((n,c)=>n+c.productCount,0),totalShops:new Set(products.flatMap(p=>p.shopIds)).size,totalGmv,totalSales,growthRate:null,analytics:{gmv:scalarAnalytics('ESTIMATED',totalGmv,'DATASET_V2',METHOD_ESTIMATED_GMV)}},catalog:categories,currencies:[...new Set(products.map(p=>p.currency).filter((currency):currency is string=>!!currency))].sort()};});
 get(base+'/categories/:category',req=>service.categoryDetail(String(req.params.category),undefined,commerce,service.rangeMeta(q(req)).days));
 get(base+'/categories/:category/subcategories/:subCategory',req=>service.categoryDetail(String(req.params.category),String(req.params.subCategory),commerce,service.rangeMeta(q(req)).days));
}
 get('/trends/keywords',req=>service.keywords(q(req)));
 list('/trends',req=>service.videos(q(req)));
 get('/videos/:id',req=>service.videoDetail(id(req.params.id)));
 list('/videos/:id/products',req=>service.videoProducts(id(req.params.id),q(req)));
 get('/videos/:id/history',req=>service.videoHistory(id(req.params.id)));
 get('/creators/:id/history',async req=>{const detail=await service.creatorDetail(id(req.params.id),false,q(req));return detail.timeline;});
get('/commerce/trend-videos',async req=>(await service.videos({...q(req),pageSize:req.query.limit??12},true)).items);
get('/commerce/demo-products',async()=>[]);
get('/commerce/products/:id/intelligence',async req=>{const product=await service.productDetail(id(req.params.id));const observations=await db.productObservation.findMany({where:{productId:product.id},include:{record:{include:{file:{include:{source:true}}}}}});return {product,observations,history:observations.map(o=>({capturedAt:o.observedAt})),provenance:observations.map(o=>({recordId:o.rawRecordId,file:o.record.file.relativePath,sha256:o.record.file.sha256,source:o.record.file.source.code})),limitations:['Không có GMV được xác minh hoặc thời điểm thu thập Product trong CSV.','CDN media chưa có canonical post ID nên chưa tạo liên kết thương mại.']};});
get('/analytics/trends',async()=>({totalCurrent:null,totalPrevious:null,growthRate:null,trend:'unknown',label:'Không có lịch sử thương mại theo ngày',timeline:[],keywords:await service.keywords(),analytics:{gmv:{dataKind:'UNKNOWN',state:'NO_TIMESTAMP',coverage:{start:null,end:null,anchor:'dataset',points:0,source:null},method:null},timeline:{dataKind:'UNKNOWN',state:'NO_TIMESTAMP',coverage:{start:null,end:null,anchor:'dataset',points:0,source:null},method:null}}}));
get('/analytics/market',async req=>{const mode=parseMode(req.query.mode);const days=service.rangeMeta(q(req)).days;return {mode,days,growth:await marketGrowth(mode,days),limitations:[mode==='SIMULATION'?'SIMULATION: dữ liệu mô phỏng, không dùng cho xếp hạng thị trường thực.':'REAL_DATA: chỉ dùng dữ liệu VERIFIED/ESTIMATED (loại trừ mô phỏng).']};});
get('/analytics/products/:id/competition',async req=>competition(id(req.params.id),parseMode(req.query.mode)));
get('/analytics/products/:id/affiliate',async req=>affiliateContribution(id(req.params.id),parseMode(req.query.mode)));
get('/analytics/shops/:id',async req=>{const result=await shopPerformance(id(req.params.id),parseMode(req.query.mode));if(!result)throw AppError.notFound('Không có dữ liệu Shop cho chế độ này');return result;});
get('/analytics/creators/:id',async req=>{const result=await creatorPerformance(id(req.params.id),parseMode(req.query.mode));if(!result)throw AppError.notFound('Không có dữ liệu Creator cho chế độ này');return result;});
get('/trend-analysis/overview',req=>service.trendData(q(req)));
get('/trend-analysis/comparison',req=>service.trendData(q(req)));
get('/trend-analysis/periods',async req=>{const r=await service.trendData(q(req));return {periods:r.periods,anchor:r.periods[0]?.end,days:service.rangeMeta(q(req)).days};});
get('/trend-analysis/category/:category',req=>service.trendData(q(req),String(req.params.category)));
get('/price-segments/definitions',async()=>service.priceSegments.map(s=>({...s,max:Number.isFinite(s.max)?s.max:null})));
get('/price-segments/overview',req=>service.segmentOverview(q(req)));
list('/price-segments/products',async req=>service.paginate(await service.segmentedProducts(q(req)),q(req)));
get('/price-segments/products/:id/variants',req=>service.productDetail(id(req.params.id)));
for(const kind of ['products','shops'])get(`/growth/${kind}/:id`,async req=>{if(kind==='products')await service.productDetail(id(req.params.id));else await service.shopDetail(id(req.params.id));return service.emptyGrowth(service.rangeMeta(q(req)).days);});
get('/jobs',async req=>(await db.processingRun.findMany({where:req.query.status?{status:String(req.query.status)}:{},orderBy:{id:'desc'},take:Math.min(100,Math.max(1,Number(req.query.limit)||20))})).map(service.jobCard));
get('/jobs/:id',async req=>{const j=await db.processingRun.findUnique({where:{id:id(req.params.id)}});if(!j)throw AppError.notFound('Không tìm thấy tác vụ');return service.jobCard(j);});
async function status(){const j=await db.processingRun.findFirst({orderBy:{id:'desc'}});return {running:false,isRunning:false,config:{apifyConfigured:false,fallbackEnabled:false,shopOnly:true,cron:null,timezone:'Asia/Ho_Chi_Minh',profiles:[],searchQueries:[],resultsPerPage:0,externalActionsEnabled:false},job:j?service.jobCard(j):null,mode:'DATASET_OFFLINE'};}
for(const path of ['/scrape/status','/scrape/profile-status','/scrape/tiktok-shop/status'])get(path,status);
for(const path of ['/scrape','/scrape/run-top-shops','/scrape/tiktok-shop','/creators/scrape','/admin/echotik/sync'])router.post(path,blocked);
get('/admin/echotik/status',async()=>({canRun:false,reason:'DATASET_OFFLINE; quota phải đối soát riêng trước khi bật',enabled:false}));
get('/admin/echotik/quota',async()=>({usedThisMonth:null,remainingThisMonth:null,totalQuota:null,canSync:false,state:'UNRECONCILED'}));
router.post('/categories/sync',asyncHandler(async(_req,res)=>{sendSuccess(res,{categories:await db.category.count(),subCategories:await db.subCategory.count(),mode:'DATASET_MAPPING',changed:0});}));
get('/products/:id/ai-analysis/latest',async req=>{await service.productDetail(id(req.params.id));const row=await db.aiAnalysisReport.findFirst({where:{productId:id(req.params.id),status:'COMPLETED'},orderBy:{id:'desc'}});return row?serializeProductReport(row):null;});
get('/products/:id/ai-analysis',async req=>{await service.productDetail(id(req.params.id));return (await db.aiAnalysisReport.findMany({where:{productId:id(req.params.id)},orderBy:{id:'desc'}})).map(serializeProductReport);});
get('/ai-analysis/:reportId',async req=>{const raw=String(req.params.reportId);if(!/^[1-9][0-9]*$/.test(raw))throw AppError.badRequest('ID report không hợp lệ');const report=await db.aiAnalysisReport.findUnique({where:{id:BigInt(raw)}});if(!report)throw AppError.notFound('Không có báo cáo AI trong Database mới');return serializeProductReport(report);});
 post('/products/:id/ai-analysis',async req=>{await service.productDetail(id(req.params.id));return createProductAnalysisV2(id(req.params.id),req.body);});
 post('/products/:id/deep-analysis',async req=>{await service.productDetail(id(req.params.id));return createProductDeepAnalysis(id(req.params.id),req.body??{});});
 get('/products/:id/deep-analysis/latest',async req=>{await service.productDetail(id(req.params.id));const report=await getProductDeepAnalysis(id(req.params.id));if(!report)throw AppError.notFound('Chưa có báo cáo phân tích chuyên sâu cho sản phẩm này');return report;});
 get('/products/:id/deep-analysis',async req=>{await service.productDetail(id(req.params.id));return listProductDeepAnalyses(id(req.params.id));});
 get('/winning-products',async req=>findWinningProducts(req.query));
 post('/products/:id/deep-analysis/ask',async req=>{await service.productDetail(id(req.params.id));const body=(req.body??{}) as {question?:unknown;mode?:unknown;history?:unknown};return askProductFollowUp(id(req.params.id),String(body.question??''),{mode:body.mode,history:Array.isArray(body.history)?body.history:[]});});
get('/datasets/status',async()=>({generation:2,legacyFallback:false,externalActionsEnabled:false,sources:await db.dataSource.findMany({include:{files:{select:{relativePath:true,recordCount:true,sha256:true}}}}),states:await db.rawRecord.groupBy({by:['state'],_count:true})}));
function targetBody(req:Request,partial=false) {
 const input=req.body; if(!input||typeof input!=='object'||Array.isArray(input))throw AppError.badRequest('Body không hợp lệ');
 const data:Record<string,unknown>={};
 for(const key of ['username','platformShopId','displayName','category','note'])if(Object.hasOwn(input,key)){if(input[key]!==null&&typeof input[key]!=='string')throw AppError.badRequest(`${key} phải là chuỗi`);data[key]=input[key]?.trim()||null;}
 if(!partial||Object.hasOwn(input,'username')){const username=String(data.username??'').replace(/^@/,'').toLowerCase();if(!/^[a-z0-9._]{1,64}$/.test(username))throw AppError.badRequest('Username không hợp lệ');data.username=username;}
 if(Object.hasOwn(input,'priority')){if(!['TOP10','TOP50','TOP100'].includes(input.priority))throw AppError.badRequest('Priority không hợp lệ');data.priority=input.priority;}
 if(Object.hasOwn(input,'isActive')){if(typeof input.isActive!=='boolean')throw AppError.badRequest('isActive phải là boolean');data.isActive=input.isActive;}
  if(Object.hasOwn(input,'scrapeConfig')){if(input.scrapeConfig!==null&&(typeof input.scrapeConfig!=='object'||Array.isArray(input.scrapeConfig)))throw AppError.badRequest('scrapeConfig không hợp lệ');if(input.scrapeConfig?.maxItems!==undefined&&(!Number.isSafeInteger(input.scrapeConfig.maxItems)||input.scrapeConfig.maxItems<1))throw AppError.badRequest('maxItems phải là số nguyên dương');data.scrapeConfig=input.scrapeConfig;}
 return data;
}
const targetCard=(t:Record<string,unknown>)=>({...t,lastScrapedAt:null,scrapeCount:0,failCount:0});
list('/targets',async req=>{if(req.query.isActive!==undefined&&!['true','false'].includes(String(req.query.isActive)))throw AppError.badRequest('isActive phải là true hoặc false');if(req.query.priority&&!['TOP10','TOP50','TOP100'].includes(String(req.query.priority)))throw AppError.badRequest('Priority không hợp lệ');const rows=await db.targetedShop.findMany({where:{...(req.query.category?{category:String(req.query.category)}:{}),...(req.query.priority?{priority:String(req.query.priority)}:{}),...(req.query.isActive!==undefined?{isActive:req.query.isActive==='true'}:{}),...(req.query.search?{OR:[{username:{contains:String(req.query.search),mode:'insensitive'}},{displayName:{contains:String(req.query.search),mode:'insensitive'}}]}:{})},orderBy:{id:'asc'}});return service.paginate(rows.map(targetCard),q(req));});
get('/targets/:id',async req=>{const t=await db.targetedShop.findUnique({where:{id:id(req.params.id)}});if(!t)throw AppError.notFound('Không tìm thấy mục tiêu');return targetCard(t);});
router.post('/targets',asyncHandler(async(req,res)=>{const data=targetBody(req);const existing=await db.targetedShop.findUnique({where:{username:String(data.username)}});if(existing)throw AppError.conflict('Username đã tồn tại');const row=await db.targetedShop.create({data:data as Parameters<typeof db.targetedShop.create>[0]['data']});sendSuccess(res,targetCard(row),201);}));
router.patch('/targets/:id',asyncHandler(async(req,res)=>{const target=id(req.params.id);if(!await db.targetedShop.findUnique({where:{id:target}}))throw AppError.notFound('Không tìm thấy mục tiêu');sendSuccess(res,targetCard(await db.targetedShop.update({where:{id:target},data:targetBody(req,true)})));}));
router.patch('/targets/:id/toggle',asyncHandler(async(req,res)=>{const target=id(req.params.id);const t=await db.targetedShop.findUnique({where:{id:target}});if(!t)throw AppError.notFound('Không tìm thấy mục tiêu');if(req.body?.isActive!==undefined&&typeof req.body.isActive!=='boolean')throw AppError.badRequest('isActive phải là boolean');sendSuccess(res,targetCard(await db.targetedShop.update({where:{id:target},data:{isActive:req.body?.isActive??!t.isActive}})));}));
router.delete('/targets/:id',asyncHandler(async(req,res)=>{const target=id(req.params.id);if(!await db.targetedShop.findUnique({where:{id:target}}))throw AppError.notFound('Không tìm thấy mục tiêu');await db.targetedShop.delete({where:{id:target}});sendSuccess(res,{deleted:true});}));
export default router;
