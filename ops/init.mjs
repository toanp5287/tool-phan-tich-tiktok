import 'dotenv/config';
console.log('Preparing isolated dataset database');
import pg from 'pg';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const legacy = new URL(process.env.DATABASE_URL);
const target = new URL(legacy); target.pathname = '/tiktok_datasets_v2';
if (target.pathname === legacy.pathname) throw new Error('Database targets must differ');
const env = { ...process.env, NEW_DATABASE_URL: target.toString() };
function prisma(args) { const r=spawnSync(process.execPath,['node_modules/prisma/build/index.js',...args],{env,encoding:'utf8'}); if(r.status!==0)throw new Error(r.stderr||r.stdout); return r.stdout; }
const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect();
try {
 const existing=await c.query('SELECT datname FROM pg_database WHERE datname=$1',['tiktok_datasets_v2']);
 if(existing.rowCount)throw new Error('Target already exists: refusing automatic recreation');
 await c.query('CREATE DATABASE tiktok_datasets_v2 TEMPLATE template0');
}finally{await c.end();}
await stat(resolve('prisma'));
await mkdir('prisma/migrations-v2/20261108000000_dataset_baseline',{recursive:true});
const base=prisma(['migrate','diff','--from-empty','--to-schema','prisma/schema.prisma','--script','--config','prisma.v2.config.ts']);
const checks=`
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_one_target" CHECK (num_nonnulls("productId","shopId","creatorId","channelId","videoId")=1);
ALTER TABLE "CategoryMapping" ADD CONSTRAINT "CategoryMapping_one_target" CHECK (num_nonnulls("categoryId","subCategoryId","thirdLevelCategoryId")=1);
ALTER TABLE "CreatorCategory" ADD CONSTRAINT "CreatorCategory_one_subject" CHECK (num_nonnulls("creatorId","channelId")=1);
ALTER TABLE "RelationEvidence" ADD CONSTRAINT "RelationEvidence_one_target" CHECK (num_nonnulls("productShopId","productCreatorId","creatorShopId","productVideoId","productCategoryId","creatorCategoryId","videoCategoryId")=1);
CREATE UNIQUE INDEX "ProductCategory_primary" ON "ProductCategory"("productId") WHERE "isPrimary";
CREATE FUNCTION validate_product_category() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."subCategoryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SubCategory" WHERE id=NEW."subCategoryId" AND "categoryId"=NEW."categoryId") THEN RAISE EXCEPTION 'subcategory parent mismatch'; END IF;
 IF NEW."thirdLevelCategoryId" IS NOT NULL AND (NEW."subCategoryId" IS NULL OR NOT EXISTS (SELECT 1 FROM "ThirdLevelCategory" WHERE id=NEW."thirdLevelCategoryId" AND "subCategoryId"=NEW."subCategoryId")) THEN RAISE EXCEPTION 'third-level parent mismatch'; END IF; RETURN NEW; END $$;
CREATE TRIGGER "ProductCategory_parent" BEFORE INSERT OR UPDATE ON "ProductCategory" FOR EACH ROW EXECUTE FUNCTION validate_product_category();
DO $$ DECLARE r record; BEGIN FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname='public' LOOP EXECUTE format('ALTER SEQUENCE %I RESTART WITH 1000000000',r.sequencename); END LOOP; END $$;
COMMENT ON SCHEMA public IS 'TikTok dataset database v2; no legacy data';
`;
await writeFile('prisma/migrations-v2/20261108000000_dataset_baseline/migration.sql',base+checks);
await writeFile('prisma/migrations-v2/migration_lock.toml','provider = "postgresql"'+String.fromCharCode(10));
console.log(prisma(['migrate','deploy','--config','prisma.v2.config.ts']));
const current=await readFile('.env','utf8');
if(/^NEW_DATABASE_URL=/m.test(current))throw new Error('NEW_DATABASE_URL already configured; inspect before changing');
await writeFile('.env',current+String.fromCharCode(10)+'NEW_DATABASE_URL='+JSON.stringify(target.toString())+String.fromCharCode(10));
console.log(JSON.stringify({database:'tiktok_datasets_v2',legacyUnchanged:true}));
