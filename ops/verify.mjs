import 'dotenv/config';
import pg from 'pg';
import assert from 'node:assert/strict';
import { FILES, parseCsv, count, postId, topics, semanticCategory } from './import.mjs';
assert.equal(count('1.2M'),1200000n);
assert.equal(count('Share'),null);
assert.equal(count('7512607981138119967'),7512607981138119967n);
assert.equal(postId('https://www.tiktok.com/@x/photo/7520120196040854792'), '7520120196040854792');
assert.deepEqual(topics('[nan]'),[]);
assert.deepEqual(semanticCategory('VIBES pajamas'),['Thời trang & Phụ kiện','Đồ ngủ']);
const c=new pg.Client({connectionString:process.env.NEW_DATABASE_URL});
await c.connect();
try {
 await c.query('BEGIN READ ONLY');
 const counts={};
 for(const table of ['DataSource','DatasetFile','RawRecord','Product','ProductVariant','Shop','Creator','CreatorChannel','Video','ProductObservation','ShopObservation','CreatorChannelObservation','VideoObservation','ProductShop','ProductCreator','CreatorShop','ProductVideo','RelationEvidence']) counts[table]=Number((await c.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
 assert.equal(counts.RawRecord,38687);assert.equal(counts.VideoObservation,35750);assert.equal(counts.Video,10114);
 assert.equal(counts.ProductCreator,0);assert.equal(counts.CreatorShop,0);assert.equal(counts.ProductVideo,0);
 const files=(await c.query('SELECT f.*,s.code FROM "DatasetFile" f JOIN "DataSource" s ON s.id=f."sourceId"')).rows;
 for(const f of FILES){const parsed=parseCsv(f[3]);const stored=files.find(x=>x.relativePath===f[3]);assert.ok(stored);assert.equal(stored.sha256,parsed.sha256);assert.equal(stored.recordCount,parsed.records.length);assert.equal(Number((await c.query('SELECT count(*) FROM "RawRecord" WHERE "datasetFileId"=$1',[stored.id])).rows[0].count),parsed.records.length);}
 assert.equal(Number((await c.query(`SELECT count(*) FROM "RawRecord" WHERE issues ? 'SOURCE_ID_URL_CONFLICT'`)).rows[0].count),5114);
 assert.equal(Number((await c.query(`SELECT count(*) FROM "RawRecord" WHERE issues ? 'INVALID_SHARE_COUNT'`)).rows[0].count),848);
 assert.equal(Number((await c.query(`SELECT count(*) FROM "VideoObservation" o JOIN "RawRecord" r ON r.id=o."rawRecordId" JOIN "DatasetFile" f ON f.id=r."datasetFileId" JOIN "DataSource" s ON s.id=f."sourceId" WHERE s.code='vitied'`)).rows[0].count),34750);
 assert.equal(Number((await c.query(`SELECT count(*) FROM "ExternalIdentity" WHERE "externalId" LIKE '%*%'`)).rows[0].count),0);
 const sources=(await c.query('SELECT code FROM "DataSource" ORDER BY code')).rows.map(x=>x.code);assert.deepEqual(sources,['brightdata-posts','brightdata-shop','kol-gov','vitied']);
 const constraints=(await c.query(`SELECT conname FROM pg_constraint WHERE NOT convalidated AND connamespace='public'::regnamespace`)).rows;assert.equal(constraints.length,0);
 const unresolved=(await c.query(`SELECT state,count(*)::int AS records FROM "RawRecord" GROUP BY state`)).rows;
 console.log(JSON.stringify({result:'PASS',counts,states:unresolved,sourceFiles:files.map(x=>({path:x.relativePath,sha256:x.sha256,records:x.recordCount})),legacyImported:false}));
 await c.query('ROLLBACK');
}finally{await c.end();}
