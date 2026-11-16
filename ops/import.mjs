import 'dotenv/config';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../generated/v2');
export const VERSION = 'dataset-v2.1';
export const FILES = [
 ['brightdata-shop','Bright Data Shop','UNVERIFIED','datasets/raw/brightdata/TikTok Shop dataset sample.csv'],
 ['brightdata-posts','Bright Data Posts','UNVERIFIED','datasets/raw/brightdata/TikTok - Posts.csv'],
 ['vitied','ViTIED','ACADEMIC_ONLY','datasets/raw/vitied/training_data.csv'],
 ['vitied','ViTIED','ACADEMIC_ONLY','datasets/raw/vitied/streaming_data.csv'],
 ['kol-gov','KOL channel CSV','UNVERIFIED','datasets/raw/kol-gov/kol-data.csv'],
];
export function count(value) {
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const s=String(value).trim();
 if(/^\d+$/.test(s))return BigInt(s);
 const m=s.match(/^(\d+(?:\.\d+)?)([KMB])?(?: videos)?$/i);
 if(!m)return null;
 const [whole,fraction='']=m[1].split('.');
 const n=(BigInt(whole+fraction)*BigInt(({K:1000,M:1000000,B:1000000000})[m[2]?.toUpperCase()]??1))/(10n**BigInt(fraction.length));
 return n;
}
export function money(v) {return v!==null&&v!==undefined&&/^\d+(?:\.\d+)?$/.test(String(v).trim())?String(v).trim():null;}
export function json(v,fallback=null) {try{return v?JSON.parse(v):fallback;}catch{return fallback;}}
export function topics(v) {
 // Only quoted topic tokens are accepted; never evaluate Python expressions.
 if(!v||/\bnan\b/i.test(v))return [];
 return [...String(v).matchAll(/['"]([A-Za-z_ &]+)['"]/g)].map(m=>m[1]);
}
export function postId(v) {try{return new URL(v).pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1]??null;}catch{return null;}}
export function canonicalProfile(platform,url,username) {
 if(platform==='tiktok') {
  let handle=username;
  try {handle=new URL(url).pathname.match(/^\/@([^/]+)/)?.[1]??handle;}catch{}
  return handle&&!handle.includes('*')?`https://www.tiktok.com/@${handle.replace(/^@/,'').toLowerCase()}`:null;
 }
 try {const u=new URL(url);if(!['http:','https:'].includes(u.protocol))return null;u.hash='';u.search='';return u.toString().replace(/\/$/,'');}catch{return null;}
}
const currency = v=>({ '₫':'VND','฿':'THB','S$':'SGD','RM':'MYR' }[v]??(/^[A-Z]{3}$/.test(v??'')?v:null));
const date = v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d;};
const bool=v=>v===true||v==='true'||v==='True'||v==='1'?true:v===false||v==='false'||v==='False'||v==='0'?false:null;
const small=v=>{const n=count(v);return n!==null&&n<=2147483647n?Number(n):null;};
const safeRating=v=>{const n=money(v);return n!==null&&Number(n)<=5?n:null;};
const slug=v=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');
const roots={beauty:'Mỹ phẩm & Làm đẹp','beauty & personal care':'Mỹ phẩm & Làm đẹp',fashion:'Thời trang & Phụ kiện','womenswear & underwear':'Thời trang & Phụ kiện','womenswear underwear':'Thời trang & Phụ kiện','menswear & underwear':'Thời trang & Phụ kiện','fashion accessories':'Thời trang & Phụ kiện',food:'Thực phẩm & Đồ uống','food & beverages':'Thực phẩm & Đồ uống',health:'Sức khoẻ',mom_and_baby:'Mẹ & Bé','baby & maternity':'Mẹ & Bé',tech_and_household:'Công nghệ & Gia dụng','phones & electronics':'Điện tử & Công nghệ','home supplies':'Đồ gia dụng & Nhà cửa',kitchenware:'Đồ gia dụng & Nhà cửa','household appliances':'Đồ gia dụng & Nhà cửa'};
export function semanticCategory(title) {
 const s=String(title??'').toLowerCase();
 if(/earphones?|headphones?|tai nghe|bluetooth/.test(s))return ['Điện tử & Công nghệ','Âm thanh','Tai nghe'];
 if(/pajamas?|pyjamas?|pijama/.test(s))return ['Thời trang & Phụ kiện','Đồ ngủ'];
 if(/face mask|micro fiber mask|mặt nạ/.test(s))return ['Mỹ phẩm & Làm đẹp','Chăm sóc da','Mặt nạ'];
 if(/gummies|candy|chocolate/.test(s))return ['Thực phẩm & Đồ uống','Đồ ăn vặt'];
 return [];
}
export function parseCsv(path) {
 const r=spawnSync('python',['-X','utf8','ops/parse_csv.py',path],{encoding:'utf8',maxBuffer:150*1024*1024});
 if(r.status!==0)throw new Error(r.stderr||'CSV parsing failed');return JSON.parse(r.stdout);
}
async function execute(db) {
 const run=await db.processingRun.create({data:{kind:'DATASET_IMPORT',status:'RUNNING',parserVersion:VERSION,mappingVersion:VERSION}});
 const identities=new Map((await db.externalIdentity.findMany()).map(x=>[`${x.namespace}:${x.externalId}`,x]));
 const channels=new Map((await db.creatorChannel.findMany()).map(x=>[x.profileUrl,x]));
 const cats=new Map((await db.category.findMany()).map(x=>[x.name,x]));
 const subs=new Map((await db.subCategory.findMany()).map(x=>[`${x.categoryId}:${x.name}`,x]));
 const thirds=new Map((await db.thirdLevelCategory.findMany()).map(x=>[`${x.subCategoryId}:${x.name}`,x]));
 let found=0,saved=0,skipped=0,quarantined=0;
 async function identify(tx,namespace,key,kind,data,rawRecordId) {
  if(!key||key.includes('*'))throw new Error('Invalid external identity');
  const lookup=`${namespace}:${key}`;const existing=identities.get(lookup);if(existing)return existing[`${kind}Id`];
  const entity=await tx[kind].create({data});
  const identity=await tx.externalIdentity.create({data:{namespace,externalId:key,[`${kind}Id`]:entity.id,rawRecordId,verificationStatus:'VERIFIED'}});
  identities.set(lookup,identity);return entity.id;
 }
 async function category(tx,names,sourceId) {
  let cat=null,sub=null,third=null;
  for(let level=0;level<Math.min(names.length,3);level++){
   const sourceName=names[level].trim();if(!sourceName)break;
   const name=level===0?(roots[sourceName.toLowerCase()]??sourceName):sourceName;
   if(level===0){cat=cats.get(name);if(!cat){cat=await tx.category.create({data:{name,slug:slug(name)||'category'}});cats.set(name,cat);}}
   if(level===1){const key=`${cat.id}:${name}`;sub=subs.get(key);if(!sub){sub=await tx.subCategory.create({data:{categoryId:cat.id,name,slug:slug(name)||'subcategory'}});subs.set(key,sub);}}
   if(level===2){const key=`${sub.id}:${name}`;third=thirds.get(key);if(!third){third=await tx.thirdLevelCategory.create({data:{subCategoryId:sub.id,name,slug:slug(name)||'third-level'}});thirds.set(key,third);}}
   await tx.categoryMapping.upsert({where:{sourceId_sourcePath:{sourceId,sourcePath:JSON.stringify(names.slice(0,level+1))}},update:{},create:{sourceId,sourcePath:JSON.stringify(names.slice(0,level+1)),sourceName,categoryId:level===0?cat.id:null,subCategoryId:level===1?sub.id:null,thirdLevelCategoryId:level===2?third.id:null,verificationStatus:'VERIFIED'}});
  }return {categoryId:cat?.id,subCategoryId:sub?.id??null,thirdLevelCategoryId:third?.id??null};
 }
 async function evidence(tx,rawRecordId,key,id,status,path,explanation,method='SOURCE_FIELD') {
  await tx.relationEvidence.create({data:{rawRecordId,[key]:id,verificationStatus:status,method,evidencePath:path,explanation}});
 }
 async function channel(tx,{platform='tiktok',url,username,uid,displayName,bio,avatarUrl,market,isVerified},rawRecordId) {
  const profileUrl=canonicalProfile(platform,url,username);if(!profileUrl)return null;
  let ch=channels.get(profileUrl);
  if(!ch){
   let creatorId=null;
   if(uid&&/^\d+$/.test(uid))creatorId=await identify(tx,'tiktok:user',uid,'creator',{displayName:displayName||username||uid,verificationStatus:'VERIFIED'},rawRecordId);
   ch=await tx.creatorChannel.create({data:{platform,profileUrl,platformUserId:uid??null,username:profileUrl.split('@')[1]??username??null,displayName:displayName||username||null,bio:bio||null,avatarUrl:avatarUrl||null,market:market||null,isVerified:isVerified??null,creatorId,verificationStatus:uid?'VERIFIED':'SUGGESTED'}});channels.set(profileUrl,ch);
  }
  return ch.id;
 }
 try {
 for(const [code,name,usageRestriction,path] of FILES){
  const parsed=parseCsv(path);found+=parsed.records.length;
  const source=await db.dataSource.upsert({where:{code},update:{},create:{code,name,usageRestriction,licenseNote:usageRestriction==='ACADEMIC_ONLY'?'README: solely academic research and analysis; commercial publication not approved.':'Local source files do not establish commercial reuse permission.'}});
  const file=await db.datasetFile.upsert({where:{sourceId_sha256:{sourceId:source.id,sha256:parsed.sha256}},update:{},create:{sourceId:source.id,sha256:parsed.sha256,relativePath:path,format:'CSV',recordCount:parsed.records.length}});
  const done=new Set((await db.rawRecord.findMany({where:{datasetFileId:file.id},select:{recordNumber:true}})).map(x=>x.recordNumber));
  const pending=parsed.records.map((r,i)=>({r,n:i+1})).filter(x=>!done.has(x.n));skipped+=done.size;
  console.log(JSON.stringify({file:path,records:parsed.records.length,pending:pending.length}));
  for(let start=0;start<pending.length;start+=100){
   await db.$transaction(async tx=>{
    for(const {r,n} of pending.slice(start,start+100)){
     const issues=[];let state='ACCEPTED';let normalized={};
     const record=await tx.rawRecord.create({data:{datasetFileId:file.id,recordNumber:n,payload:r,issues:[],state:'PROCESSING',normalizerVersion:VERSION}});const rid=record.id;
     if(code==='brightdata-shop'){
      const externalId=r.id||r.url.match(/\d{15,}/)?.[0];
      if(!r.title?.trim()||!externalId){state='QUARANTINED';issues.push('MISSING_PRODUCT_TITLE_OR_ID');}
      else {
       const store=json(r.store_details,{});const storeUrl=store.url||r.seller_url;
       const shopExternal=storeUrl?.match(/\/store\/(?:[^/]+\/)?(\d+)/)?.[1];
       const marketHint=r.url.match(/shop-([a-z]{2})\.tiktok/)?.[1]??r.url.match(/\/shop\/([a-z]{2})\//)?.[1]??r.store_country;
       const market=marketHint?({uk:'GB',gb:'GB'}[marketHint]??marketHint.toUpperCase()):null;const cur=currency(r.currency);
       const image=json(r.images,[])[0]||r.image_url||null;
       const pid=await identify(tx,'tiktok:product',externalId,'product',{title:r.title.trim(),description:r.description||null,productUrl:r.url,imageUrl:image,market,currency:cur},rid);
       await tx.productObservation.create({data:{productId:pid,rawRecordId:rid,price:money(r.final_price_low||r.final_price),originalPrice:money(r.initial_price),currency:cur,soldCount:count(r.sold),ratingScore:safeRating(r.prodct_rating),ratingCount:count(r.reviews_count),isAvailable:bool(r.available),quality:{observedAt:'NOT_PROVIDED',gmv:'NOT_OBSERVED',stock:bool(r.In_stock),priceRange:{min:money(r.final_price_low||r.final_price),max:money(r.final_price_high||r.final_price)}}}});
       for(const v of json(r.variations,[])){if(!v.sku||String(v.sku).includes('*'))continue;await tx.productVariant.upsert({where:{productId_platformSkuId:{productId:pid,platformSkuId:String(v.sku)}},update:{},create:{productId:pid,platformSkuId:String(v.sku),name:(v.sku_sales_props??[]).map(p=>p.value).filter(Boolean).join(' / ')||null,attributes:Object.fromEntries((v.sku_sales_props??[]).map(p=>[p.name,p.value])),price:money(v.final_price),originalPrice:money(v.initial_price),currency:currency(v.currency),stock:small(v.stock),isAvailable:v.stock==null?null:v.stock>0}});}
       if(shopExternal&&store.name){
        const sid=await identify(tx,'tiktok:shop',shopExternal,'shop',{name:store.name,shopUrl:storeUrl,market:r.store_country?({uk:'GB'}[r.store_country]??r.store_country.toUpperCase()):null,avatarUrl:store.badge||null},rid);
        const link=await tx.productShop.upsert({where:{productId_shopId:{productId:pid,shopId:sid}},update:{},create:{productId:pid,shopId:sid,verificationStatus:'VERIFIED'}});
        await evidence(tx,rid,'productShopId',link.id,'VERIFIED','store_details.url','Product source identifies seller by complete store URL');
        await tx.shopObservation.create({data:{shopId:sid,rawRecordId:rid,followerCount:count(store.followers),productCount:small(store.num_of_items),ratingScore:safeRating(store.rating),quality:{num_sold:'UNVERIFIED_SEMANTICS',observedAt:'NOT_PROVIDED'}}});
       } else issues.push('SHOP_ID_MISSING_OR_MASKED');
       const tree=json(r.category_tree,[]).map(x=>x.name).filter(Boolean);const inferred=tree.length?[]:semanticCategory(r.title);const names=tree.length?tree:inferred;
       if(names.length){const c=await category(tx,names,source.id);const status=tree.length?'VERIFIED':'SUGGESTED';const link=await tx.productCategory.create({data:{productId:pid,...c,isPrimary:true,method:tree.length?'SOURCE_PATH':'CONTENT_RULE',verificationStatus:status}});await evidence(tx,rid,'productCategoryId',link.id,status,tree.length?'category_tree':'title',tree.length?'Source category path':'Conservative semantic title rule; requires review',tree.length?'SOURCE_PATH':'CONTENT_RULE');}
       if(json(r.related_videos,[]).length)issues.push('RELATED_CDN_MEDIA_WITHOUT_CANONICAL_POST_ID');
       normalized={productId:pid,externalId,market,currency:cur};
      }
     }else if(code==='kol-gov'){
      const platform=r.channel_type?.trim().toLowerCase();const cid=await channel(tx,{platform,url:r.channel_url,displayName:r.channel_name||r.nick_name||r.name},rid);
      if(!cid){state='QUARANTINED';issues.push('NO_IDENTIFIABLE_CHANNEL');}
      else {await tx.creatorChannelObservation.create({data:{channelId:cid,rawRecordId:rid,followerCount:count(r.followers),viewCount:count(r.views),likeCount:count(r.likes),quality:{observedAt:'NOT_PROVIDED',zeroValues:'SOURCE_REPORTED_UNVERIFIED',identity_verified:r.identity_verified}}});normalized={channelId:cid,platform};}
     }else {
      const vitied=code==='vitied';const url=vitied?r.vid_url:r.url;const externalId=vitied?postId(url):r.post_id;
      if(!externalId){state='QUARANTINED';issues.push('MISSING_POST_ID');}
      else {
       const observedAt=vitied?date(r.vid_scrapeTime):null;
       const username=vitied?r.user_name:r.account_id;
       const cid=await channel(tx,{url:vitied?url:r.profile_url,username,uid:vitied?null:r.profile_id,displayName:username,bio:vitied?null:r.profile_biography,avatarUrl:vitied?null:r.profile_avatar,market:vitied?'VN':null,isVerified:vitied?null:bool(r.is_verified)},rid);
       const publishedAt=date(vitied?r.vid_postTime:r.create_time);let duration=null;const rawDuration=vitied?r.vid_duration:r.video_duration;
       if(rawDuration?.includes(':')){const a=rawDuration.split(':').map(Number);duration=a.reduce((n,v)=>n*60+v,0);}else if(rawDuration)duration=Number(rawDuration);
       const postType=url.includes('/photo/')?'images':vitied?'video':r.post_type;
       if(postType==='images')duration=null;
       const hashtags=vitied?(r.vid_hashtags||'').split(',').map(x=>x.trim()).filter(Boolean):json(r.hashtags,[]);
       const vid=await identify(tx,'tiktok:post',externalId,'video',{channelId:cid,caption:(vitied?r.vid_caption:r.description)||null,postType,publishedAt,durationSeconds:Number.isFinite(duration)?duration:null,postUrl:url,coverUrl:vitied?null:r.preview_image||null,market:vitied?'VN':null,hashtags},rid);
       if(vitied&&r.vid_id!==externalId)issues.push('SOURCE_ID_URL_CONFLICT');
       if(vitied&&r.vid_nshare==='Share')issues.push('INVALID_SHARE_COUNT');
       const metricFields=vitied?{playCount:r.vid_nview,diggCount:r.vid_nlike,commentCount:r.vid_ncomment,shareCount:r.vid_nshare,collectCount:r.vid_nsave}:{playCount:r.play_count,diggCount:r.digg_count,commentCount:r.comment_count,shareCount:r.share_count||r.num_share_count,collectCount:r.collect_count};
       const values=Object.fromEntries(Object.entries(metricFields).map(([k,v])=>[k,count(v)]));
       const quality=Object.fromEntries(Object.entries(metricFields).map(([k,v])=>[k,count(v)===null?(v?'INVALID':'MISSING'):/[KMB]/i.test(v??'')?'ROUNDED':'SOURCE_REPORTED']));
       await tx.videoObservation.create({data:{videoId:vid,rawRecordId:rid,observedAt,...values,quality:{...quality,sourcePublishedAt:vitied?r.vid_postTime:r.create_time,sourceId:vitied?r.vid_id:r.post_id,observedAt:vitied?'SOURCE_TIMESTAMP':'NOT_PROVIDED'}}});
       if(cid)await tx.creatorChannelObservation.create({data:{channelId:cid,rawRecordId:rid,observedAt,followerCount:count(vitied?r.user_nfollower:r.profile_followers),likeCount:vitied?count(r.user_total_likes):null,quality:{followerCount:/[KMB]/i.test(r.user_nfollower??'')?'ROUNDED':'SOURCE_REPORTED',observedAt:vitied?'SOURCE_TIMESTAMP':'NOT_PROVIDED'}}});
       for(const topic of vitied?topics(r.topic):[]){const c=await category(tx,[topic],source.id);const vc=await tx.videoCategory.upsert({where:{videoId_categoryId:{videoId:vid,categoryId:c.categoryId}},update:{},create:{videoId:vid,categoryId:c.categoryId,method:'SOURCE_TOPIC',verificationStatus:'SUGGESTED'}});await evidence(tx,rid,'videoCategoryId',vc.id,'SUGGESTED','topic','Source content topic is not a commercial endorsement');if(cid){const cc=await tx.creatorCategory.upsert({where:{channelId_categoryId:{channelId:cid,categoryId:c.categoryId}},update:{},create:{channelId:cid,categoryId:c.categoryId,method:'SOURCE_TOPIC',verificationStatus:'SUGGESTED'}});await evidence(tx,rid,'creatorCategoryId',cc.id,'SUGGESTED','topic','Content activity topic only');}}
       normalized={videoId:vid,channelId:cid,externalId,sourceId:vitied?r.vid_id:r.post_id};
      }
     }
     await tx.rawRecord.update({where:{id:rid},data:{state,issues,normalized}});
     saved++;if(state==='QUARANTINED')quarantined++;
    }
   },{timeout:120000,maxWait:15000});
   if(start%2000===0)console.log(JSON.stringify({file:path,processed:Math.min(start+100,pending.length)}));
  }
 }
 await db.processingRun.update({where:{id:run.id},data:{status:'COMPLETED',finishedAt:new Date(),recordsFound:found,recordsSaved:saved,recordsUpdated:skipped,recordsQuarantined:quarantined,metadata:{files:FILES.map(f=>f[3]),legacyImported:false,externalRequests:0}}});
 return {found,saved,skipped,quarantined};
 }catch(e){await db.processingRun.update({where:{id:run.id},data:{status:'FAILED',finishedAt:new Date(),recordsFound:found,recordsSaved:saved,errorMessage:String(e).slice(0,3000)}});throw e;}
}
export async function main(){
 if(!process.env.NEW_DATABASE_URL)throw new Error('NEW_DATABASE_URL required');
 if(new URL(process.env.NEW_DATABASE_URL).pathname==='/tiktok_analytics')throw new Error('Legacy database is forbidden');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.NEW_DATABASE_URL})});
 try{console.log(JSON.stringify(await execute(db)));}finally{await db.$disconnect();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
