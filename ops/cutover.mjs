import 'dotenv/config';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
const target=new URL(process.env.NEW_DATABASE_URL);
if(target.pathname!=='/tiktok_datasets_v2')throw new Error('Unexpected cutover database');
if(process.env.DATASET_MODE==='v2')throw new Error('Cutover already recorded; refusing to rotate credentials automatically');
const c=new pg.Client({connectionString:target.toString()});await c.connect();
try {
 const check=(await c.query('SELECT count(*)::int AS n FROM "RawRecord"')).rows[0];if(check.n!==38687)throw new Error('Dataset verification required before cutover');
 const password=randomBytes(32).toString('hex');
 const exists=(await c.query("SELECT 1 FROM pg_roles WHERE rolname='tiktok_dataset_app'")).rowCount;
 if(exists)throw new Error('Runtime role exists; review previous cutover before retry');
 await c.query(`CREATE ROLE tiktok_dataset_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
 await c.query('GRANT CONNECT ON DATABASE tiktok_datasets_v2 TO tiktok_dataset_app');
 await c.query('GRANT USAGE ON SCHEMA public TO tiktok_dataset_app');
 await c.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tiktok_dataset_app');
 await c.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO tiktok_dataset_app');
 await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO tiktok_dataset_app');
 await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO tiktok_dataset_app');
 const runtime=new URL(target);runtime.username='tiktok_dataset_app';runtime.password=password;runtime.hostname='127.0.0.1';
 const original=await readFile('.env','utf8');
 const settings={DATABASE_URL:runtime.toString(),NEW_DATABASE_URL:runtime.toString(),DATASET_MIGRATION_URL:target.toString(),DATASET_MODE:'v2',SCRAPE_SCHEDULER_ENABLED:'false',SCRAPE_ON_STARTUP:'false',SCRAPE_SHOP_ON_STARTUP:'false',SCRAPE_AUTO_START_LOOP:'false',ECHOTIK_ENABLED:'false',GEMINI_ENABLED:'false'};
 let text=original;
 for(const [key,value] of Object.entries(settings)){const line=key+'='+JSON.stringify(value);const pattern=new RegExp('^'+key+'=.*$','m');text=pattern.test(text)?text.replace(pattern,()=>line):text+String.fromCharCode(10)+line;}
 await writeFile('.env',text);
 console.log(JSON.stringify({cutover:'CONFIGURED',database:'tiktok_datasets_v2',runtimeRole:'tiktok_dataset_app',legacyFallback:false,externalActionsEnabled:false}));
}finally{await c.end();}
