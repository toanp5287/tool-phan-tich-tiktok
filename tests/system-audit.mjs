import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { datasetDb as db, datasetPool as pool } from '../dist/config/datasetDb.js';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
try {
 for(const model of ['product','shop','creator','creatorChannel','video','productVariant','productShop','productCreator','creatorShop','productVideo','productCategory','videoCategory','creatorCategory','targetedShop','processingRun']) console.log(model,await db[model].count());
 for(const model of ['productObservation','shopObservation','videoObservation','creatorChannelObservation']) console.log(model,JSON.stringify(await db[model].aggregate({_count:{_all:true,observedAt:true},_min:{observedAt:true},_max:{observedAt:true}})));
 console.log('sources',JSON.stringify(await db.dataSource.findMany({include:{files:{select:{relativePath:true,recordCount:true}}}})));
 console.log('relations',JSON.stringify(await db.productShop.groupBy({by:['verificationStatus'],_count:true})));
 console.log('dated-channel',JSON.stringify(await db.creatorChannelObservation.findFirst({where:{observedAt:{not:null},followerCount:{not:null}},select:{channelId:true,observedAt:true}})));
 console.log('regions',JSON.stringify(await db.product.groupBy({by:['market','currency'],_count:true})));
 const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]);
 const files=[...walk('src'),...walk('public')];
 console.log('protected',JSON.stringify(Object.fromEntries(files.filter(f=>/aiAnalysis|ai-analysis|[\\/]ai[\\/]/i.test(f)).map(f=>[f,hash(f)]))));
 console.log('envHash',hash('.env'));
 const caches=walk('data/echotik').filter(f=>f.endsWith('.json')&&f.includes(`${path.sep}raw${path.sep}`));
 const cacheSummary={files:caches.length,emptyArrays:0,gmvKeys:new Set(),dateKeys:new Set()};
 const scan=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){if(!value.length)cacheSummary.emptyArrays++;for(const row of value)scan(row);return;}for(const [key,v] of Object.entries(value)){if(/gmv|revenue/i.test(key))cacheSummary.gmvKeys.add(key);if(/date|time|crawl/i.test(key))cacheSummary.dateKeys.add(key);scan(v);}};
 for(const f of caches)scan(JSON.parse(fs.readFileSync(f,'utf8')));
 console.log('echotik-cache',JSON.stringify({...cacheSummary,gmvKeys:[...cacheSummary.gmvKeys],dateKeys:[...cacheSummary.dateKeys]}));
 const sample=await db.videoObservation.findFirst({where:{observedAt:{not:null}},select:{observedAt:true,record:{select:{payload:true}}}});
 console.log('timestamp-source',JSON.stringify({observedAt:sample?.observedAt,source:sample?.record.payload?.vid_scrapeTime}));
} finally {await db.$disconnect();await pool.end();}
