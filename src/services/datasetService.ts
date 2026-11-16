import { datasetDb as db } from '../config/datasetDb.js';
import { AppError } from '../utils/errors.js';
import { readMetricSeries } from './snapshotService.js';
import { buildGrowthSummary, buildTimeline, coverage, competition, parseMode, readSeries, type AnalysisMode } from './analyticsService.js';
import {
  METHOD_ESTIMATED_GMV,
  analyticsMeta,
  datedAnalytics,
  datasetDay,
  estimatedGmv,
  scalarAnalytics,
  stateForGrowth,
  sumNumbers,
} from './analytics.js';

const num = (v: unknown): number | null => { if(v === null || v === undefined || v === '') return null; const n=Number(v); return Number.isFinite(n) && Math.abs(n)<=Number.MAX_SAFE_INTEGER?n:null; };
const iso = (v: Date | null | undefined) => v?.toISOString() ?? null;
const missingTimeline = () => ({points:[] as Array<{date:string;value:number}>,analytics:datedAnalytics([],'UNKNOWN',null,null)});
export interface DatasetMetric { current:number|null; previous:number|null; diff:number|null; changePercent:number|null; delta:number|null; growthRate:number|null; direction:string; hasData:boolean; hasBaseline:boolean }
export const unavailableMetric = ():DatasetMetric => ({ current:null, previous:null, diff:null, changePercent:null, delta:null, growthRate:null, direction:'unknown', hasData:false, hasBaseline:false });
export function emptyGrowth(days=30) { const periods=[1,7,30,90].map(days=>({days,gmv:unavailableMetric(),sales:unavailableMetric(),orders:unavailableMetric(),salesDiff:null,gmvDelta:null,salesGrowthRate:null,gmvGrowthRate:null,direction:'unknown',hasData:false})); return {primary:periods.find(p=>p.days===days)??periods[2],periods,metrics:periods}; }
const revenue = () => ({ video:null,live:null,cart:null,productCard:null,total:null,videoShare:null,liveShare:null,cartShare:null,productCardShare:null,isEstimated:false,analytics:analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source:null},'NO_TIMESTAMP',null),state:'NOT_OBSERVED' });
const productInclude = {identities:true,variants:true,observations:{orderBy:[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}],take:1,include:{record:{include:{file:{include:{source:true}}}}}},shops:{where:{verificationStatus:'VERIFIED' as const,isActive:true},include:{shop:true}},categories:{where:{isPrimary:true},include:{category:true,subCategory:true,thirdLevel:true}}};
type ProductRow = Awaited<ReturnType<typeof loadProducts>>[number];
export async function loadProducts() { return db.product.findMany({include:productInclude,orderBy:{id:'asc'}}); }
function qualityRecord(value: unknown): Record<string, unknown> { return value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}; }
export function productCard(p: ProductRow) {
 const o=p.observations[0]; const cat=p.categories[0];const link=p.shops[0]; const prices=p.variants.filter(v=>v.currency===p.currency).map(v=>num(v.price)).filter((v):v is number=>v!==null); const originals=p.variants.filter(v=>v.currency===p.currency).map(v=>num(v.originalPrice)).filter((v):v is number=>v!==null);
 const range=qualityRecord(qualityRecord(o?.quality).priceRange); const price=num(o?.price); const sold=num(o?.soldCount); const estimatePrice=price??(prices.length?Math.min(...prices):num(range.min)); const estGmv=p.currency&&(!o?.currency||o.currency===p.currency)?estimatedGmv(sold,estimatePrice):null; const source=o?.record.file.source.code??null; const salesMeta=scalarAnalytics('UNKNOWN',sold,source,'SOURCE_REPORTED_CUMULATIVE_UNITS'); const gmvMeta=scalarAnalytics('ESTIMATED',estGmv,source,METHOD_ESTIMATED_GMV); const growthMeta=analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source},stateForGrowth(false),null);
  return {
   id:p.id,platformProductId:p.identities.find(i=>i.namespace==='tiktok:product')?.externalId??null,title:p.title,description:p.description,imageUrl:p.imageUrl,productUrl:p.productUrl,
   category:cat?.category.name??null,subCategory:cat?.subCategory?.name??null,thirdLevelCategory:cat?.thirdLevel?.name??null,classificationStatus:cat?.verificationStatus??null,
   classification:{status:cat?.status??null,tier:cat?.status??null,confidence:cat?.confidence??null,reason:cat?.reason??null,method:cat?.method??null},
   shopId:link?.shopId??null,shopIds:p.shops.map(l=>l.shopId),shopName:link?.shop.name??null,shopAvatarUrl:link?.shop.avatarUrl??null,currency:p.currency,region:p.market,price,
   minPrice:prices.length?Math.min(...prices):num(range.min)??price,maxPrice:prices.length?Math.max(...prices):num(range.max)??price,minOriginalPrice:originals.length?Math.min(...originals):num(o?.originalPrice),maxOriginalPrice:originals.length?Math.max(...originals):num(o?.originalPrice),
   variantCount:p.variants.length,stockTotal:p.variants.length&&p.variants.every(v=>v.stock!==null)?p.variants.reduce((n,v)=>n+(v.stock??0),0):null,ratingScore:num(o?.ratingScore),ratingCount:num(o?.ratingCount),isAvailable:o?.isAvailable??null,
   soldCount:sold,sales:sold,sellerCount:p.shops.length,gmv:estGmv,views:null,likes:null,shares:null,comments:null,growthRate:null,growth:emptyGrowth(),firstSeenAt:iso(o?.observedAt),lastSeenAt:iso(o?.observedAt),capturedAt:iso(o?.observedAt),source,
   analytics:{gmv:gmvMeta,sales:salesMeta,growth:growthMeta},dataQuality:{gmv:estGmv===null?'UNKNOWN':'ESTIMATED',collectionTime:o?.observedAt?'KNOWN':'NOT_PROVIDED',history:'NO_DATED_COMMERCE_HISTORY',usageRestriction:o?.record.file.source.usageRestriction??null,classification:cat?.verificationStatus??null}
  };
}
export function paginate<T>(items:T[],query:Record<string,unknown>) {const parse=(v:unknown,fallback:number,max:number)=>{if(v===undefined)return fallback;const s=String(v);if(!/^[1-9][0-9]*$/.test(s)||!Number.isSafeInteger(Number(s)))throw AppError.badRequest('Phân trang phải là số nguyên dương');return Math.min(max,Number(s));};const page=parse(query.page,1,1000000);const pageSize=parse(query.pageSize??query.limit,20,100);return {items:items.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:items.length,totalPages:Math.max(1,Math.ceil(items.length/pageSize))}};}
function sortItems<T extends Record<string,unknown>>(items:T[],query:Record<string,unknown>,keys:Record<string,string>,fallback='id') {const key=keys[String(query.sortBy)]??fallback;const direction=query.sortDir==='asc'?1:-1;return items.sort((a,b)=>a[key]==null?b[key]==null?Number(a.id)-Number(b.id):1:b[key]==null?-1:typeof a[key]==='number'&&typeof b[key]==='number'?(Number(a[key])-Number(b[key]))*direction:String(a[key]).localeCompare(String(b[key]))*direction);}
function filterProducts(items:ReturnType<typeof productCard>[],q:Record<string,unknown>,commerce=false) {return items.filter(p=>(!commerce||p.region==='VN')&&(!q.region||p.region===q.region)&&(!q.currency||p.currency===q.currency)&&(!q.category||p.category===q.category)&&(!q.subCategory||p.subCategory===q.subCategory)&&(!q.shopId||p.shopIds.includes(Number(q.shopId)))&&(!q.search&&!q.q||`${p.title} ${p.shopName??''} ${p.platformProductId}`.toLowerCase().includes(String(q.search??q.q).toLowerCase())));}
export async function products(q:Record<string,unknown>,commerce=false) {return paginate(sortItems(filterProducts((await loadProducts()).map(productCard),q,commerce),q,{sales:'soldCount',price:'minPrice',minPrice:'minPrice',sellers:'sellerCount',recent:'id',gmv:'gmv'}),q);}
export async function productDetail(id:number,commerce=false,days=30, mode: AnalysisMode = 'REAL_DATA') {
 const p=await db.product.findUnique({where:{id},include:productInclude});if(!p||commerce&&p.market!=='VN')throw AppError.notFound('Không tìm thấy sản phẩm trong Database dataset mới');
 const card=productCard(p); const links=await db.productVideo.findMany({where:{productId:id,verificationStatus:'VERIFIED'},include:{video:{include:videoInclude}}}); const videos=links.map(x=>videoCard(x.video));
  const salesSeries=await readSeries('PRODUCT',id,'soldCount',mode);
  const priceSeries=await readSeries('PRODUCT',id,'price',mode);
  const gmvSeries=await readSeries('PRODUCT',id,'gmv',mode);
  const salesPoints=salesSeries.map(p=>({date:p.date,value:p.value}));
  const gmvPoints=gmvSeries.map(p=>({date:p.date,value:p.value}));
  const pricePoints=priceSeries.map(p=>({date:p.date,value:p.value}));
  const timeline=buildTimeline(salesSeries,gmvSeries,priceSeries);
  const growth=buildGrowthSummary(salesSeries,gmvSeries,days);
  const coverageInfo=coverage(salesSeries,90);
  const competitionInfo=await competition(id,mode);
 return {...card,variants:p.variants.map(v=>({id:v.id,platformSkuId:v.platformSkuId,name:v.name,attributes:v.attributes,price:num(v.price),originalPrice:num(v.originalPrice),currency:v.currency,stock:v.stock,soldCount:null,isAvailable:v.isAvailable})),timeline:timeline.points,history:[],historySeries:{sales:salesPoints,gmv:gmvPoints,views:[],likes:[],price:pricePoints},mode,analytics:{...card.analytics,timeline:datedAnalytics(timeline.points,timeline.dataKind,'DATASET_V2','LATEST_DAILY_SNAPSHOT'),salesTimeline:datedAnalytics(salesPoints,timeline.dataKind,'DATASET_V2','LATEST_DAILY_SNAPSHOT')},growth,coverage:coverageInfo,competition:competitionInfo,revenueSources:revenue(),topTrendVideos:videos,trendVideos:videos,topTrendVideo:videos[0]??null,topCreators:[],soldCount1d:null,soldCount7d:null,soldCount30d:null,soldCount90d:null,shop:p.shops[0]?{id:p.shops[0].shop.id,name:p.shops[0].shop.name,avatarUrl:p.shops[0].shop.avatarUrl,bannerUrl:null,shopUrl:p.shops[0].shop.shopUrl}:null,shops:p.shops.map(l=>({productShopId:l.id,shopId:l.shopId,name:l.shop.name,username:null,avatarUrl:l.shop.avatarUrl,shopUrl:l.shop.shopUrl,isActive:l.isActive,price:card.price,sales:card.sales,gmv:card.gmv,analytics:card.analytics}))};
}
const videoInclude={identities:true,channel:true,observations:{orderBy:[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}],take:1,include:{record:{include:{file:{include:{source:true}}}}}},categories:{include:{category:true}},products:{where:{verificationStatus:'VERIFIED' as const}}};
type VideoRow=Awaited<ReturnType<typeof loadVideos>>[number];
async function loadVideos(q:Record<string,unknown>={}){
 if(!q.range&&!q.days)return db.video.findMany({include:videoInclude});
 const latest=await db.videoObservation.findFirst({where:{observedAt:{not:null}},orderBy:{observedAt:'desc'},select:{observedAt:true}});
 if(!latest?.observedAt)return [];
 const end=Date.parse(datasetDay(latest.observedAt)+'T23:59:59.999+07:00')-(q.range==='yesterday'?86400000:0);
 const start=end-rangeMeta(q).days*86400000+1;
 return db.video.findMany({where:{observations:{some:{observedAt:{gte:new Date(start),lte:new Date(end)}}}},include:{...videoInclude,observations:{...videoInclude.observations,where:{observedAt:{gte:new Date(start),lte:new Date(end)}}}}});
}
export function videoCard(v:VideoRow){const o=v.observations[0];const views=num(o?.playCount);const likes=num(o?.diggCount);const shares=num(o?.shareCount);const comments=num(o?.commentCount);return {id:v.id,platformVideoId:v.identities.find(x=>x.namespace==='tiktok:post')?.externalId??null,content:v.caption??'',title:v.caption??'',author:v.channel?.username??v.channel?.displayName??null,videoUrl:v.postUrl,coverUrl:v.coverUrl,imageUrl:v.coverUrl,postType:v.postType,publishedAt:iso(v.publishedAt),scrapedAt:iso(o?.observedAt),bucketDate:o?.observedAt?.toISOString().slice(0,10)??null,durationSeconds:num(v.durationSeconds),playCount:views,viewsCount:views,diggCount:likes,shareCount:shares,commentCount:comments,collectCount:num(o?.collectCount),engagementRate:views&&likes!==null&&shares!==null&&comments!==null?(likes+shares+comments)*100/views:null,productId:v.products[0]?.productId??null,shopId:null,price:null,sales:null,gmv:null,kind:'video',category:v.categories[0]?.category.name??null,subCategory:null,shopName:null,viewTrend:unavailableMetric(),dataQuality:{source:o?.record.file.source.code??null,usageRestriction:o?.record.file.source.usageRestriction??null,metrics:o?.quality??null,scope:v.products.length?'COMMERCE':'SOCIAL'}};}
export async function videos(q:Record<string,unknown>={},commerce=false){let rows=await loadVideos(q);if(commerce)rows=rows.filter(v=>v.products.length>0);if(q.category)rows=rows.filter(v=>v.categories.some(c=>c.category.name===q.category));if(q.creatorId)rows=rows.filter(v=>v.channelId===Number(q.creatorId));if(q.search)rows=rows.filter(v=>`${v.caption??''} ${v.channel?.username??''}`.toLowerCase().includes(String(q.search).toLowerCase()));return paginate(sortItems(rows.map(videoCard),q,{views:'playCount',playCount:'playCount',likes:'diggCount',shares:'shareCount',comments:'commentCount',recent:'scrapedAt'},'playCount'),q);}
export async function videoHistory(id:number){if(!await db.video.findUnique({where:{id},select:{id:true}}))throw AppError.notFound('Không tìm thấy bài đăng');const rows=await db.videoObservation.findMany({where:{videoId:id},orderBy:[{observedAt:'asc'},{id:'asc'}]});const byDay=new Map<string,(typeof rows)[number]>();for(const row of rows){if(row.observedAt)byDay.set(datasetDay(row.observedAt),row);}const points=[...byDay.entries()].map(([date,o])=>({date,observedAt:iso(o.observedAt),views:num(o.playCount),likes:num(o.diggCount),shares:num(o.shareCount),comments:num(o.commentCount),saves:num(o.collectCount),quality:o.quality}));const analytics=datedAnalytics(points,'UNKNOWN','DATASET_V2','LATEST_OBSERVATION_PER_VIETNAM_DAY');return {data:points,points,...analytics,analytics};}
export async function videoDetail(id:number){
 const video=await db.video.findUnique({where:{id},include:videoInclude});if(!video)throw AppError.notFound('Không tìm thấy bài đăng');
 const [products,history,provenance]=await Promise.all([videoProducts(id,{}),videoHistory(id),relationProvenance({videoId:id})]);
 return {...videoCard(video),channel:video.channel?{id:video.channel.id,creatorId:video.channel.creatorId,username:video.channel.username,displayName:video.channel.displayName,profileUrl:video.channel.profileUrl,avatarUrl:video.channel.avatarUrl}:null,products:products.items,history:history.data,analytics:{history:history.analytics,gmv:scalarAnalytics('UNKNOWN',null,null,'NO_DIRECT_VIDEO_REVENUE_ATTRIBUTION')},relations:{products:{count:products.pagination.total,state:products.pagination.total?'VERIFIED':'NO_DATA',reason:products.pagination.total?null:'No canonical product reference appears with this post ID in available source payloads'}},provenance};
}
const shopInclude={identities:true,observations:{orderBy:[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}],take:1,include:{record:{include:{file:{include:{source:true}}}}}},products:{where:{verificationStatus:'VERIFIED' as const,isActive:true}}};
type ShopRow=Awaited<ReturnType<typeof loadShops>>[number];
async function loadShops(){return db.shop.findMany({where:{isSimulated:false},include:shopInclude});}
function shopCard(s:ShopRow){const o=s.observations[0];const source=o?.record.file.source.code??null;const growthMeta=analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source},stateForGrowth(false),null);return {id:s.id,platformShopId:s.identities[0]?.externalId??null,name:s.name,username:null,avatarUrl:s.avatarUrl,bannerUrl:null,shopUrl:s.shopUrl,region:s.market,productCount:s.products.length,reportedProductCount:o?.productCount??null,followerCount:num(o?.followerCount),ratingScore:num(o?.ratingScore),ratingCount:null,totalGmv:null,gmv:null,totalSales:null,sales:null,totalViews:null,avgOrderValue:null,avgPrice:null,growthRate:null,growth:emptyGrowth(),revenueSources:revenue(),lastSeenAt:iso(o?.observedAt),firstSeenAt:iso(o?.observedAt),hasGmv:false,hasSales:false,linkedProductCount:s.products.length,topProducts:[],source,analytics:{gmv:scalarAnalytics('UNKNOWN',null,source,METHOD_ESTIMATED_GMV),sales:scalarAnalytics('UNKNOWN',null,source,null),growth:growthMeta},dataQuality:{scope:'KNOWN_LINKED_PRODUCTS_ONLY',gmv:'UNKNOWN'}};}
function shopMetrics(ps:ReturnType<typeof productCard>[]){const money=ps.filter(p=>p.currency==='VND');const totalGmv=sumNumbers(money.map(p=>p.gmv));const totalSales=sumNumbers(ps.map(p=>p.sales));const pricedSales=sumNumbers(money.filter(p=>p.gmv!==null).map(p=>p.sales));const prices=money.map(p=>p.price).filter((value):value is number=>value!==null);const totalViews=sumNumbers(ps.map(p=>p.views));return {totalGmv,totalSales,totalViews,avgPrice:prices.length?prices.reduce((sum,value)=>sum+value,0)/prices.length:null,avgOrderValue:totalGmv!==null&&pricedSales?totalGmv/pricedSales:null};}
function enrichShop(card:ReturnType<typeof shopCard>,ps:ReturnType<typeof productCard>[]){const metrics=shopMetrics(ps);const linkedProductGmvEstimate=metrics.totalGmv;const linkedProductSales=metrics.totalSales;return {...card,totalGmv:null,gmv:null,totalSales:null,sales:null,totalViews:metrics.totalViews,avgOrderValue:null,avgPrice:metrics.avgPrice,hasGmv:false,hasSales:false,linkedProductGmvEstimate,linkedProductSales,dataQuality:{...card.dataQuality,gmv:'UNKNOWN',linkedProductMetrics:linkedProductGmvEstimate===null?'NO_DATA':'PRODUCT_GLOBAL_NOT_ALLOCATED_TO_SHOP'},topProducts:ps.filter(p=>p.gmv!==null).sort((a,b)=>(b.gmv??0)-(a.gmv??0)).slice(0,3).map(p=>({id:p.id,title:p.title,imageUrl:p.imageUrl,sales:p.sales,gmv:p.gmv})),analytics:{...card.analytics,gmv:scalarAnalytics('UNKNOWN',null,card.source,'PRODUCT_GLOBAL_METRIC_NOT_ALLOCATED_TO_SHOP'),sales:scalarAnalytics('UNKNOWN',null,card.source,null),linkedProductGmvEstimate:scalarAnalytics('ESTIMATED',linkedProductGmvEstimate,card.source,METHOD_ESTIMATED_GMV)}};}
export async function shops(q:Record<string,unknown>,commerce=false){const rows=(await loadShops()).filter(s=>(!commerce||s.market==='VN')&&(!q.region||q.region===s.market)&&(!q.search||s.name.toLowerCase().includes(String(q.search).toLowerCase())));const productRows=await loadProducts();const cards=new Map(productRows.map(row=>[row.id,productCard(row)]));const byShop=new Map<number,ReturnType<typeof productCard>[]>();for(const row of productRows){const card=cards.get(row.id)!;for(const link of row.shops){const list=byShop.get(link.shopId)??[];list.push(card);byShop.set(link.shopId,list);}}return paginate(sortItems(rows.map(s=>enrichShop(shopCard(s),byShop.get(s.id)??[])),q,{products:'productCount',gmv:'linkedProductGmvEstimate',sales:'linkedProductSales',recent:'id'}),q);}
export async function shopDetail(id:number,commerce=false,days=30){
 const s=await db.shop.findUnique({where:{id},include:shopInclude});if(!s||s.isSimulated||commerce&&s.market!=='VN')throw AppError.notFound('Không tìm thấy Shop');
 const productRows=await loadProducts();const ps=productRows.filter(p=>p.shops.some(l=>l.shopId===id)).map(productCard);const card=enrichShop(shopCard(s),ps);
 const [creatorLinks,provenance]=await Promise.all([
  db.creatorShop.findMany({where:{shopId:id,verificationStatus:'VERIFIED'},include:{creator:{include:{channels:{where:{platform:'tiktok'},include:{observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1}},take:1}}}}}),
  relationProvenance({shopId:id}),
 ]);
 const creators=creatorLinks.map(link=>creatorShopCard(link));
  const gmvSeries=(await readSeries('SHOP',id,'gmv','SIMULATION')).slice(-days);
  const gmvTimeline=gmvSeries.map(p=>({date:p.date,value:p.value}));
  const timelineAnalytics=datedAnalytics(gmvTimeline,gmvSeries[0]?.dataKind??'UNKNOWN','SIMULATION','SIMULATED_DAILY_SNAPSHOT');
  return {...card,analytics:{...card.analytics,timeline:timelineAnalytics,salesTimeline:timelineAnalytics},shop:{...card,soldCountTotal:card.totalSales},products:ps,topProducts:[...ps].sort((a,b)=>(b.sales??-1)-(a.sales??-1)).slice(0,10),newProducts:[],topAffiliates:creators,topTrendVideos:[],salesTimeline:gmvTimeline,gmvTimeline,revenueSources:commerce?revenue():{series:[],summary:revenue(),analytics:analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source:card.source},'NO_TIMESTAMP',null)},relations:{products:{count:ps.length,state:ps.length?'VERIFIED':'NO_DATA'},creators:{count:creators.length,state:creators.length?'VERIFIED':'NO_DATA',reason:creators.length?null:'No verified creator-to-shop attribution in dataset'},videos:{count:0,state:'NO_DATA',reason:'No canonical product-to-video attribution can be rolled up to this shop'}},provenance};
}
const channelInclude={observations:{orderBy:[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}],take:1,include:{record:{include:{file:{include:{source:true}}}}}},videos:{select:{observations:{orderBy:[{observedAt:{sort:'desc' as const,nulls:'last' as const}},{id:'desc' as const}],take:1,select:{playCount:true,diggCount:true,shareCount:true,commentCount:true}}}},_count:{select:{videos:true}},categories:{include:{category:true}}};
type ChannelRow=Awaited<ReturnType<typeof loadChannels>>[number];
async function loadChannels(){return db.creatorChannel.findMany({where:{platform:'tiktok'},include:channelInclude});}
function channelCard(c:ChannelRow){
 const o=c.observations[0],source=o?.record.file.source.code??null;
 const growthMeta=analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source},stateForGrowth(false),null);
 const counts=c.videos.flatMap(v=>{const row=v.observations[0];if(!row)return [];const values=[num(row.playCount),num(row.diggCount),num(row.shareCount),num(row.commentCount)];return values.every((n):n is number=>n!==null)&&values[0]!>0?[values as number[]]:[];});
 const views=counts.reduce((sum,values)=>sum+values[0]!,0),interactions=counts.reduce((sum,values)=>sum+values[1]!+values[2]!+values[3]!,0);
 const engagementRate=views>0?interactions*100/views:null;
 return {id:c.id,creatorId:c.creatorId,platformCreatorId:c.platformUserId,username:c.username,displayName:c.displayName??c.username??'',avatarUrl:c.avatarUrl,bio:c.bio,region:c.market,platform:c.platform,profileUrl:c.profileUrl,role:'CREATOR',followerCount:num(o?.followerCount),likeCount:num(o?.likeCount),viewCount:num(o?.viewCount),engagementRate,gmv:null,soldCount:null,videoCount:c._count.videos,growthRate:null,growth:emptyGrowth(),topProducts:[],firstSeenAt:null,lastSeenAt:iso(o?.observedAt),source,analytics:{gmv:scalarAnalytics('UNKNOWN',null,source,METHOD_ESTIMATED_GMV),sales:scalarAnalytics('UNKNOWN',null,source,null),engagement:scalarAnalytics('ESTIMATED',engagementRate,source,'SUM_LIKES_SHARES_COMMENTS_DIV_SUM_VIEWS_X100_LATEST_PER_POST'),growth:growthMeta},verificationStatus:c.verificationStatus,categories:c.categories.map(x=>({name:x.category.name,status:x.verificationStatus})),dataQuality:{identity:c.platformUserId?'SOURCE_UID':'HANDLE_ONLY',gmv:'UNKNOWN',engagementSamplePosts:counts.length}};
}
export async function creators(q:Record<string,unknown>,commerce=false){const rows=(await loadChannels()).filter(c=>(!commerce||c.market==='VN')&&(!q.region||c.market===q.region)&&q.role!=='AFFILIATE'&&(!q.search||`${c.username} ${c.displayName}`.toLowerCase().includes(String(q.search).toLowerCase())));return paginate(sortItems(rows.map(channelCard),q,{followers:'followerCount',gmv:'gmv',engagement:'engagementRate',sales:'soldCount'},'followerCount'),q);}
export async function creatorDetail(id:number,commerce=false,q:Record<string,unknown>={}){
 const c=await db.creatorChannel.findFirst({where:{id,platform:'tiktok'},include:channelInclude});
 if(!c||commerce&&c.market!=='VN')throw AppError.notFound('Không tìm thấy kênh Creator');
 const history=await db.creatorChannelObservation.findMany({where:{channelId:id,observedAt:{not:null}},orderBy:[{observedAt:'asc'},{id:'asc'}]});
 const vs=(await videos({creatorId:id,pageSize:6,...q})).items,card=channelCard(c);
 let selected=history;
 if(q.range||q.days){
  const latest=await db.creatorChannelObservation.findFirst({where:{observedAt:{not:null}},orderBy:{observedAt:'desc'},select:{observedAt:true}});
  if(latest?.observedAt){const end=Date.parse(datasetDay(latest.observedAt)+'T23:59:59.999+07:00')-(q.range==='yesterday'?86400000:0),start=end-rangeMeta(q).days*86400000+1;selected=history.filter(o=>o.observedAt&&o.observedAt.getTime()>=start&&o.observedAt.getTime()<=end);}else selected=[];
 }
 const daily=new Map<string,(typeof history)[number]>();for(const o of selected)if(o.observedAt)daily.set(datasetDay(o.observedAt),o);
 const timeline=[...daily].map(([date,o])=>({date,followers:num(o.followerCount),likes:num(o.likeCount),gmv:null,soldCount:null}));
  const [productLinks,shopLinks,provenance]=await Promise.all([
   c.creatorId===null?Promise.resolve([]):db.productCreator.findMany({where:{creatorId:c.creatorId,verificationStatus:'VERIFIED'},include:{product:{include:productInclude}}}),
   c.creatorId===null?Promise.resolve([]):db.creatorShop.findMany({where:{creatorId:c.creatorId,verificationStatus:'VERIFIED'},include:{shop:true}}),
   relationProvenance({channelId:c.id,creatorId:c.creatorId}),
  ]);
  const products=productLinks.map(link=>({...productCard(link.product),verificationStatus:link.verificationStatus,attributedGmv:null,attributedSales:null}));
  const shops=shopLinks.map(link=>({id:link.shop.id,name:link.shop.name,avatarUrl:link.shop.avatarUrl,shopUrl:link.shop.shopUrl,market:link.shop.market,verificationStatus:link.verificationStatus,gmv:null,sales:null}));
  return {...card,firstSeenAt:iso(history[0]?.observedAt),products,topProducts:products.slice(0,10),shops,timeline,analytics:{...card.analytics,timeline:datedAnalytics(timeline,'UNKNOWN',card.source,'LATEST_OBSERVATION_PER_VIETNAM_DAY')},trendVideos:vs,topTrendVideos:vs,channels:[channelCard(c)],relations:{products:{count:products.length,state:products.length?'VERIFIED':'NO_DATA'},shops:{count:shops.length,state:shops.length?'VERIFIED':'NO_DATA'},videos:{count:vs.length,state:vs.length?'VERIFIED':'NO_DATA'}},provenance};
}

export async function shopProducts(id:number,q:Record<string,unknown>,commerce=false){
 const shop=await db.shop.findUnique({where:{id},select:{id:true,market:true}});if(!shop||commerce&&shop.market!=='VN')throw AppError.notFound('Không tìm thấy Shop');
 const rows=(await loadProducts()).filter(row=>row.shops.some(link=>link.shopId===id)).map(productCard);
 const items=sortItems(rows.filter(row=>(!q.search||`${row.title} ${row.category??''}`.toLowerCase().includes(String(q.search).toLowerCase()))),q,{sales:'soldCount',price:'minPrice',gmv:'gmv',recent:'id'});
 return paginate(items,q);
}

export async function productCreators(id:number,q:Record<string,unknown>){
 if(!await db.product.findUnique({where:{id},select:{id:true}}))throw AppError.notFound('Không tìm thấy sản phẩm');
 const links=await db.productCreator.findMany({where:{productId:id,verificationStatus:'VERIFIED'},include:{creator:{include:{channels:{where:{platform:'tiktok'},include:{observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1}},take:1}}}}});
 return paginate(links.map(creatorLinkCard),q);
}

export async function productVideos(id:number,q:Record<string,unknown>){
 if(!await db.product.findUnique({where:{id},select:{id:true}}))throw AppError.notFound('Không tìm thấy sản phẩm');
 const links=await db.productVideo.findMany({where:{productId:id,verificationStatus:'VERIFIED'},include:{video:{include:videoInclude}}});
 return paginate(links.map(link=>({...videoCard(link.video),verificationStatus:link.verificationStatus,attributedGmv:null,attributedSales:null})),q);
}

export async function videoProducts(id:number,q:Record<string,unknown>){
 if(!await db.video.findUnique({where:{id},select:{id:true}}))throw AppError.notFound('Không tìm thấy bài đăng');
 const links=await db.productVideo.findMany({where:{videoId:id,verificationStatus:'VERIFIED'},include:{product:{include:productInclude}}});
 return paginate(links.map(link=>({...productCard(link.product),verificationStatus:link.verificationStatus,attributedGmv:null,attributedSales:null})),q);
}

export async function shopCreators(id:number,q:Record<string,unknown>,commerce=false){
 const shop=await db.shop.findUnique({where:{id},select:{id:true,market:true}});if(!shop||commerce&&shop.market!=='VN')throw AppError.notFound('Không tìm thấy Shop');
 const links=await db.creatorShop.findMany({where:{shopId:id,verificationStatus:'VERIFIED'},include:{creator:{include:{channels:{where:{platform:'tiktok'},include:{observations:{orderBy:[{observedAt:{sort:'desc',nulls:'last'}},{id:'desc'}],take:1}},take:1}}}}});
 return paginate(links.map(creatorShopCard),q);
}

export async function creatorProducts(id:number,q:Record<string,unknown>,commerce=false){
 const channel=await db.creatorChannel.findFirst({where:{id,platform:'tiktok'},select:{creatorId:true,market:true}});if(!channel||commerce&&channel.market!=='VN')throw AppError.notFound('Không tìm thấy kênh Creator');
 if(channel.creatorId===null)return paginate([],q);
 const links=await db.productCreator.findMany({where:{creatorId:channel.creatorId,verificationStatus:'VERIFIED'},include:{product:{include:productInclude}}});
 return paginate(links.map(link=>({...productCard(link.product),verificationStatus:link.verificationStatus,attributedGmv:null,attributedSales:null})),q);
}

export async function creatorShops(id:number,q:Record<string,unknown>,commerce=false){
 const channel=await db.creatorChannel.findFirst({where:{id,platform:'tiktok'},select:{creatorId:true,market:true}});if(!channel||commerce&&channel.market!=='VN')throw AppError.notFound('Không tìm thấy kênh Creator');
 if(channel.creatorId===null)return paginate([],q);
 const links=await db.creatorShop.findMany({where:{creatorId:channel.creatorId,verificationStatus:'VERIFIED'},include:{shop:true}});
 return paginate(links.map(link=>({id:link.shop.id,name:link.shop.name,avatarUrl:link.shop.avatarUrl,shopUrl:link.shop.shopUrl,market:link.shop.market,verificationStatus:link.verificationStatus,gmv:null,sales:null})),q);
}

type RelationSubject={productId?:number;shopId?:number;creatorId?:number|null;channelId?:number;videoId?:number};
async function relationProvenance(subject:RelationSubject){
 const filters=[] as Array<{productShop?:{productId?:number;shopId?:number};productCreator?:{productId?:number;creatorId?:number};creatorShop?:{shopId?:number;creatorId?:number};productVideo?:{productId?:number;videoId?:number}}>;
 if(subject.productId!==undefined)filters.push({productShop:{productId:subject.productId}},{productCreator:{productId:subject.productId}});
 if(subject.shopId!==undefined)filters.push({productShop:{shopId:subject.shopId}},{creatorShop:{shopId:subject.shopId}});
 if(subject.creatorId!==null&&subject.creatorId!==undefined)filters.push({productCreator:{creatorId:subject.creatorId}},{creatorShop:{creatorId:subject.creatorId}});
 if(subject.videoId!==undefined)filters.push({productVideo:{videoId:subject.videoId}});
 const evidence=filters.length?await db.relationEvidence.findMany({where:{OR:filters},orderBy:{id:'desc'},take:20,include:{record:{include:{file:{include:{source:true}}}}}}):[];
 return evidence.map(e=>({recordId:e.rawRecordId,verificationStatus:e.verificationStatus,method:e.method,evidencePath:e.evidencePath,explanation:e.explanation,source:e.record.file.source.code,file:e.record.file.relativePath}));
}
function creatorLinkCard(link:any){const channel=link.creator.channels[0];const observation=channel?.observations[0];return {id:link.creator.id,displayName:link.creator.displayName,channelId:channel?.id??null,username:channel?.username??null,profileUrl:channel?.profileUrl??null,avatarUrl:channel?.avatarUrl??null,followerCount:num(observation?.followerCount),verificationStatus:link.verificationStatus,attributedGmv:null,attributedSales:null,dataQuality:{attribution:'VERIFIED_RELATION_NO_DIRECT_GMV'}};}
function creatorShopCard(link:any){return {...creatorLinkCard(link),shopVerificationStatus:link.verificationStatus};}
function aggregateProducts(ps:ReturnType<typeof productCard>[]){const metrics=shopMetrics(ps);return {productCount:ps.length,shopCount:new Set(ps.flatMap(p=>p.shopIds)).size,...metrics,growthRate:null,dataKind:metrics.totalGmv===null?'UNKNOWN':'ESTIMATED',analytics:{gmv:scalarAnalytics('ESTIMATED',metrics.totalGmv,'DATASET_V2',METHOD_ESTIMATED_GMV),sales:scalarAnalytics('UNKNOWN',metrics.totalSales,'DATASET_V2','SOURCE_REPORTED_CUMULATIVE_UNITS'),growth:analyticsMeta('UNKNOWN',{start:null,end:null,anchor:'dataset',points:0,source:null},stateForGrowth(false),null)}};}
export async function categories(commerce=false){const ps=filterProducts((await loadProducts()).map(productCard),{},commerce);const rows=await db.category.findMany({include:{subCategories:{include:{thirdLevels:true}}},orderBy:{name:'asc'}});return rows.map(c=>{const subset=ps.filter(p=>p.category===c.name);return {id:c.id,catalogId:c.id,name:c.name,slug:c.slug,...aggregateProducts(subset),shareOfGmv:null,topSubCategory:subset.find(p=>p.subCategory)?.subCategory??null,growth:emptyGrowth(),hasData:subset.length>0,subCategories:c.subCategories.map(s=>({id:s.id,name:s.name,slug:s.slug,thirdLevelCategories:s.thirdLevels}))};});}
export async function categoryDetail(name:string,sub?:string,commerce=false,days=30){
 const cats=await categories(commerce),c=cats.find(c=>c.name===name||c.slug===name);
 if(!c)throw AppError.notFound('Không tìm thấy ngành hàng');
 const selected=sub?c.subCategories.find(s=>s.name===sub||s.slug===sub):undefined;
 if(sub&&!selected)throw AppError.notFound('Không tìm thấy ngành con');
 const ps=filterProducts((await loadProducts()).map(productCard),{category:c.name,...(selected?{subCategory:selected.name}:{})},commerce);
 const agg=aggregateProducts(ps),timeline=missingTimeline();
 const shopRows=await loadShops();
 const scopedShops=shopRows.filter(s=>(!commerce||s.market==='VN')&&ps.some(p=>p.shopIds.includes(s.id))).map(s=>enrichShop(shopCard(s),ps.filter(p=>p.shopIds.includes(s.id))));
 return {name:c.name,category:c.name,subCategory:selected?.name??null,...agg,hasData:ps.length>0,growth:emptyGrowth(days),shareOfGmv:null,
  subCategories:c.subCategories.map(s=>{const stats=aggregateProducts(ps.filter(p=>p.subCategory===s.name));return {...s,category:c.name,...stats,shareOfGmv:agg.totalGmv&&stats.totalGmv!==null?stats.totalGmv*100/agg.totalGmv:null,growth:emptyGrowth(days)};}),
  timeline:timeline.points,analytics:{...agg.analytics,timeline:timeline.analytics},topProducts:[...ps].sort((a,b)=>(b.sales??-1)-(a.sales??-1)).slice(0,10),shops:scopedShops.sort((a,b)=>(b.totalGmv??-1)-(a.totalGmv??-1))};
}
export function rangeMeta(q:Record<string,unknown>){const key=String(q.range??(q.days?`${q.days}d`:'30d'));if(!/^(today|yesterday|[1-9][0-9]*d)$/.test(key))throw AppError.badRequest('Khoảng thời gian không hợp lệ');const days=key==='today'||key==='yesterday'?1:Number(key.slice(0,-1));if(!Number.isSafeInteger(days)||days>90)throw AppError.badRequest('Khoảng thời gian phải từ 1 đến 90 ngày');return {key,label:key==='today'?'Hôm nay':key==='yesterday'?'Hôm qua':`${days} ngày`,days,anchor:key==='yesterday'?'yesterday':'today'};}
export async function overview(q:Record<string,unknown>,commerce=false){
 const ps=filterProducts((await loadProducts()).map(productCard),{},commerce);
  const ss=await shops({pageSize:100,sortBy:'gmv'},commerce);
 const cs=await creators({pageSize:10},commerce);
 const vs=await videos({pageSize:6},commerce);
 const cats=await categories(commerce),agg=aggregateProducts(ps);
 const last=await db.processingRun.findFirst({orderBy:{id:'desc'}});
 const days=rangeMeta(q).days;
  const simulatedGmv=await db.metricSnapshot.groupBy({by:['bucketDate'],where:{entityType:'PRODUCT',metric:'gmv',source:{startsWith:'simulated'}},_sum:{value:true},orderBy:{bucketDate:'asc'}});
  const revenuePoints=simulatedGmv.slice(-days).map(row=>({date:datasetDay(row.bucketDate),value:num(row._sum.value)}));
  const revenueTimeline={points:revenuePoints,analytics:datedAnalytics(revenuePoints,revenuePoints.length?'SIMULATED':'UNKNOWN','SIMULATION','SIMULATED_DAILY_PRODUCT_GMV')};
  const salesTimeline=missingTimeline();
 const categoryTotal=sumNumbers(cats.map(c=>c.totalGmv));
  return {range:rangeMeta(q),
  totals:{products:ps.length,shops:ss.pagination.total,creators:cs.pagination.total,snapshots:await db.productObservation.count(),trackings:await db.productShop.count(),trendVideos:vs.pagination.total,totalGmv:agg.totalGmv,totalSales:agg.totalSales,avgOrderValue:agg.avgOrderValue},
  revenue:{totalGmv:agg.totalGmv,totalSales:agg.totalSales,totalViews:agg.totalViews,avgOrderValue:agg.avgOrderValue},
  growth:emptyGrowth(days),trend:{totalCurrent:null,totalPrevious:null,growthRate:null,trend:'unknown',label:'Chưa đủ lịch sử thương mại'},
   topProducts:ps.sort((a,b)=>(b.sales??-1)-(a.sales??-1)).slice(0,100),topShops:ss.items.slice(0,10),topCreators:cs.items,topTrendVideos:vs.items,
  topCategories:cats.filter(c=>c.hasData).sort((a,b)=>(b.totalGmv??-1)-(a.totalGmv??-1)).slice(0,8).map(c=>({...c,shareOfGmv:categoryTotal&&c.totalGmv!==null?c.totalGmv*100/categoryTotal:null})),
  categoryBreakdown:cats.map(c=>({category:c.name,products:c.productCount,gmv:c.totalGmv})),
  revenueTimeline:revenueTimeline.points,salesTimeline:salesTimeline.points,
  analytics:{gmv:agg.analytics.gmv,timeline:revenueTimeline.analytics,salesTimeline:salesTimeline.analytics,growth:agg.analytics.growth},lastJob:last?jobCard(last):null,
  dataQuality:{hasProductMetrics:ps.length>0,hasGmvRanking:false,categoryCatalogOnly:ps.length===0,source:'DATASET_V2',legacyFallback:false,notice:'GMV là ước tính lũy kế từ soldCount × giá niêm yết; chỉ tổng hợp VND. Không có timestamp thương mại để vẽ lịch sử hay tính tăng trưởng. Dữ liệu thiếu giữ null.'}
 };
}
type JobRow=Awaited<ReturnType<typeof db.processingRun.findFirst>>;
export function jobCard(j:NonNullable<JobRow>){return {id:j.id,source:'dataset',jobType:j.kind,trigger:'cli',region:null,status:j.status,startedAt:iso(j.startedAt),finishedAt:iso(j.finishedAt),durationMs:j.finishedAt?j.finishedAt.getTime()-j.startedAt.getTime():null,recordsFound:j.recordsFound,recordsSaved:j.recordsSaved,recordsUpdated:j.recordsUpdated,recordsFailed:j.recordsFailed,recordsQuarantined:j.recordsQuarantined,errorMessage:j.errorMessage,createdAt:iso(j.startedAt)};}
export async function keywords(q:Record<string,unknown>={}){const rows=await loadVideos(q);const map=new Map<string,{keyword:string,count:number,totalViews:number|null}>();for(const v of rows){for(const tag of new Set(v.hashtags)){const item=map.get(tag)??{keyword:tag,count:0,totalViews:null};item.count++;item.totalViews=sumNumbers([item.totalViews,num(v.observations[0]?.playCount)]);map.set(tag,item);}}return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,Math.min(100,Math.max(1,Number(q.limit)||50))).map(x=>({...x,word:x.keyword,value:x.count,views:x.totalViews,dataKind:'UNKNOWN',method:'SUM_LATEST_CUMULATIVE_VIEWS_PER_DISTINCT_POST'}));}
export const priceSegments=[{code:'under-100k',label:'Dưới 100k',shortLabel:'Dưới 100k',min:0,max:100000},{code:'100k-300k',label:'100k – 300k',shortLabel:'100k – 300k',min:100000,max:300000},{code:'300k-500k',label:'300k – 500k',shortLabel:'300k – 500k',min:300000,max:500000},{code:'over-500k',label:'Trên 500k',shortLabel:'Trên 500k',min:500000,max:Infinity}];
export async function segmentedProducts(q:Record<string,unknown>){
 const bound=(v:unknown)=>{if(v===undefined||v==='')return null;const n=Number(v);if(!Number.isFinite(n)||n<0)throw AppError.badRequest('Giá lọc phải là số không âm');return n;};
 const min=bound(q.minPrice),max=bound(q.maxPrice);
 if(min!==null&&max!==null&&min>max)throw AppError.badRequest('Giá tối thiểu không được lớn hơn giá tối đa');
 const requested=q.segments?String(q.segments).split(','):[];
 if(requested.some(code=>!priceSegments.some(s=>s.code===code)))throw AppError.badRequest('Phân khúc giá không hợp lệ');
 const ps=filterProducts((await loadProducts()).map(productCard),q).filter(p=>p.currency==='VND'&&p.minPrice!==null&&p.maxPrice!==null).map(p=>({...p,matchedSegments:priceSegments.filter(s=>p.minPrice!<s.max&&p.maxPrice!>=s.min).map(s=>s.code),primarySegment:priceSegments.find(s=>p.minPrice!>=s.min&&p.minPrice!<s.max)!.code,priceRangeLabel:`${p.minPrice} – ${p.maxPrice} VND`}));
 return sortItems(ps.filter(p=>(!requested.length||requested.some(s=>p.matchedSegments.includes(s)))&&(!q.onlyMultiVariant||q.onlyMultiVariant==='false'||p.variantCount>1)&&(min===null||p.maxPrice!>=min)&&(max===null||p.minPrice!<=max)),q,{minPrice:'minPrice',maxPrice:'maxPrice',price:'minPrice',sales:'sales',gmv:'gmv',variants:'variantCount',views:'views'});
}
export async function segmentOverview(q:Record<string,unknown>){
 const ps=await segmentedProducts(q),agg=aggregateProducts(ps);
 const average=(values:(number|null)[])=>{const valid=values.filter((v):v is number=>v!==null);return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;};
 return {...agg,totalProducts:ps.length,multiVariantProducts:ps.filter(p=>p.variantCount>1).length,
  segmentSemantics:'Exclusive allocation by minimum listed price; product filters use interval overlap. No repeated GMV across segments.',
  segments:priceSegments.map(s=>{const subset=ps.filter(p=>p.primarySegment===s.code),stats=aggregateProducts(subset);return {...s,max:Number.isFinite(s.max)?s.max:null,...stats,shareOfProducts:ps.length?subset.length*100/ps.length:null,shareOfGmv:agg.totalGmv&&stats.totalGmv!==null?stats.totalGmv*100/agg.totalGmv:null,avgMinPrice:average(subset.map(p=>p.minPrice)),avgMaxPrice:average(subset.map(p=>p.maxPrice))};}),
  categoryBreakdown:[...new Set(ps.map(p=>p.category).filter((name):name is string=>!!name))].map(category=>{const subset=ps.filter(p=>p.category===category);return {category,totalProducts:subset.length,totalGmv:aggregateProducts(subset).totalGmv};})};
}
export async function trendData(q:Record<string,unknown>,name?:string){
 const range=rangeMeta(q), count=Math.max(2,Math.min(4,Number(q.periods)||2));
 const latest=await db.videoObservation.findFirst({where:{observedAt:{not:null}},orderBy:{observedAt:'desc'},select:{observedAt:true}});
 const now=latest?.observedAt;if(!now)throw AppError.notFound('Không có mốc thời gian quan sát trong dataset');
  const periods=Array.from({length:count},(_,index)=>{const end=new Date(Date.parse(datasetDay(now)+'T00:00:00Z')-index*range.days*86400000-(range.anchor==='yesterday'?86400000:0));return {index,label:`Kỳ ${index+1}`,start:new Date(end.getTime()-(range.days-1)*86400000).toISOString().slice(0,10),end:end.toISOString().slice(0,10),days:range.days};});
  const rows=await db.video.findMany({include:{...videoInclude,observations:{where:{observedAt:{gte:new Date(periods.at(-1)!.start+'T00:00:00+07:00'),lte:new Date(periods[0]!.end+'T23:59:59.999+07:00')}},orderBy:[{observedAt:'asc'},{id:'asc'}],include:{record:{include:{file:{include:{source:true}}}}}}}});
 const catNames=[...new Set(rows.flatMap(v=>v.categories.map(c=>c.category.name)))].sort();
 function metrics(subset:VideoRow[]){
  const result=Object.fromEntries(['sales','gmv','views','likes','shares','comments','avgPrice','products','shops','videos'].map(k=>[k,unavailableMetric()]));
   const at=(period:number)=>subset.flatMap(v=>{const p=periods[period];if(!p)return [];const observations=v.observations.filter(o=>o.observedAt&&o.observedAt>=new Date(p.start+'T00:00:00+07:00')&&o.observedAt<=new Date(p.end+'T23:59:59.999+07:00'));return observations.at(-1)?[observations.at(-1)!]:[];});
  const current=at(0),previous=at(1);
  for(const [key,field] of [['views','playCount'],['likes','diggCount'],['shares','shareCount'],['comments','commentCount']] as const){const a=current.map(o=>num(o[field])).filter((v):v is number=>v!==null),b=previous.map(o=>num(o[field])).filter((v):v is number=>v!==null);result[key]={...unavailableMetric(),current:a.length?a.reduce((n,v)=>n+v,0):null,previous:b.length?b.reduce((n,v)=>n+v,0):null};}
  result.videos={...unavailableMetric(),current:current.length,previous:previous.length};return result;
 }
 const categories=catNames.map(category=>({category,shareOfGmv:null,topSubCategory:null,metrics:metrics(rows.filter(v=>v.categories.some(c=>c.category.name===category)))}));const totals=metrics(rows);
  const meta={anchor:'dataset-latest',dataAsOf:iso(latest?.observedAt),socialHistory:true,attribution:false,analytics:{gmv:scalarAnalytics('UNKNOWN',null,null,null),views:scalarAnalytics('UNKNOWN',totals.views?.current??null,'vitied','SOURCE_REPORTED_CUMULATIVE_PER_POST')},metricSemantics:'Latest cumulative measurement per post in each period; not period sales or comparable growth.',notice:'Số đo tích luỹ theo bài đăng; không phải doanh số hoặc lượt xem phát sinh. Nguồn học thuật chưa được xác minh độc lập.'};
 if(!name)return {periods,categories,rows:categories,totals,meta};
 const subset=rows.filter(v=>v.categories.some(c=>c.category.name===name));if(!subset.length)throw AppError.notFound('Không có bài đăng cho chủ đề này');
  const byDay=new Map<string,Map<number,VideoRow['observations'][number]>>();for(const v of subset)for(const o of v.observations){if(!o.observedAt)continue;const key=datasetDay(o.observedAt);if(!byDay.has(key))byDay.set(key,new Map());byDay.get(key)!.set(v.id,o);}
  const timeline=[...byDay].sort(([a],[b])=>a.localeCompare(b)).map(([date,observations])=>({date,gmv:null,sales:null,views:sumNumbers([...observations.values()].map(o=>num(o.playCount)))}));
 const productCards=(await loadProducts()).map(productCard).filter(p=>p.category===name&&p.currency==='VND');
 const productTotal=sumNumbers(productCards.map(p=>p.gmv));
 const subNames=[...new Set(productCards.map(p=>p.subCategory??'Khác'))];
 const subCategories=subNames.map(subName=>{
  const items=productCards.filter(p=>(p.subCategory??'Khác')===subName);
  const agg=aggregateProducts(items);
  return {name:subName,category:name,...agg,shareOfGmv:productTotal&&agg.totalGmv!==null?agg.totalGmv*100/productTotal:null,growth:emptyGrowth(),metrics:{gmv:{...unavailableMetric(),current:agg.totalGmv,hasData:agg.totalGmv!==null},sales:{...unavailableMetric(),current:agg.totalSales,hasData:agg.totalSales!==null}}};
 });
 const tagMap=new Map<string,{hashtag:string;count:number;views:number|null}>();
 for(const video of subset)for(const tag of new Set(video.hashtags)){
  const current=tagMap.get(tag)??{hashtag:tag,count:0,views:null};
  current.count++;current.views=sumNumbers([current.views,num(video.observations.at(-1)?.playCount)]);tagMap.set(tag,current);
 }
 const hashtags=[...tagMap.values()].sort((a,b)=>b.count-a.count).slice(0,20).map(tag=>({...tag,trend:unavailableMetric()}));
 const topProducts=productCards.filter(p=>p.gmv!==null).sort((a,b)=>(b.gmv??0)-(a.gmv??0)).slice(0,10).map(product=>({...product,gmvTrend:unavailableMetric()}));
 const timelineAnalytics=datedAnalytics(timeline,'UNKNOWN','vitied','LATEST_CUMULATIVE_PER_POST');
 return {category:name,periods,metrics:metrics(subset),shareOfGmv:null,timeline,subCategories,topProducts,topVideos:subset.map(v=>videoCard({...v,observations:[...v.observations].reverse()})).sort((a,b)=>(b.playCount??-1)-(a.playCount??-1)).slice(0,10),hashtags,sounds:[],meta:{...meta,analytics:{...meta.analytics,timeline:timelineAnalytics}}};
}
