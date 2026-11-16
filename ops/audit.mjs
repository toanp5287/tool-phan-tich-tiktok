import pg from 'pg';
import {PrismaClient} from '../generated/v2/index.js';

const dbUrl=new URL(process.env.DATABASE_URL||process.env.NEW_DATABASE_URL);
const client=new pg.Client({connectionString:dbUrl.toString()});
await client.connect();

try {
  console.log('=== DATABASE CONNECTION ===');
  const versionResult=await client.query('SELECT version()');
  console.log(versionResult.rows[0].version.split(',')[0]);
  
  console.log('\n=== DATABASE INFO ===');
  const dbInfo=await client.query("SELECT current_database() as db, current_user as role, current_schema() as schema");
  console.log(JSON.stringify(dbInfo.rows[0]));
  
  console.log('\n=== TABLES ===');
  const tables=await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema='public' ORDER BY table_name
  `);
  for(const row of tables.rows){
    const count=await client.query(`SELECT count(*) as cnt FROM "${row.table_name}"`);
    console.log(`${row.table_name}: ${count.rows[0].cnt}`);
  }
  
  console.log('\n=== CONSTRAINTS & INDEXES ===');
  const constraints=await client.query(`
    SELECT table_name, constraint_name, constraint_type 
    FROM information_schema.table_constraints 
    WHERE table_schema='public' 
    ORDER BY table_name, constraint_type
  `);
  for(const row of constraints.rows){
    console.log(`${row.table_name} - ${row.constraint_type}: ${row.constraint_name}`);
  }
  
  console.log('\n=== RAW RECORD STATE ===');
  const rawRecordState=await client.query(`
    SELECT state, COUNT(*) as cnt 
    FROM "RawRecord" 
    GROUP BY state
  `);
  console.log(JSON.stringify(rawRecordState.rows));
  
  console.log('\n=== ENTITY COUNTS ===');
  const entityCounts=await client.query(`
    SELECT 
      (SELECT count(*) FROM "Product") as products,
      (SELECT count(*) FROM "Creator") as creators,
      (SELECT count(*) FROM "CreatorChannel") as channels,
      (SELECT count(*) FROM "Video") as videos,
      (SELECT count(*) FROM "Shop") as shops,
      (SELECT count(*) FROM "Category") as categories,
      (SELECT count(*) FROM "ProductObservation") as productObs,
      (SELECT count(*) FROM "CreatorChannelObservation") as channelObs,
      (SELECT count(*) FROM "VideoObservation") as videoObs,
      (SELECT count(*) FROM "ShopObservation") as shopObs
  `);
  console.log(JSON.stringify(entityCounts.rows[0]));
  
  console.log('\n=== VERIFICATION STATUS ===');
  const verification=await client.query(`
    SELECT 
      (SELECT count(*) FROM "RelationEvidence" WHERE "verificationStatus"='VERIFIED') as verified,
      (SELECT count(*) FROM "RelationEvidence" WHERE "verificationStatus"='SUGGESTED') as suggested,
      (SELECT count(*) FROM "RelationEvidence" WHERE "verificationStatus"='NEEDS_REVIEW') as needsReview
  `);
  console.log(JSON.stringify(verification.rows[0]));
  
  console.log('\n=== PROCESSING RUN ===');
  const runs=await client.query(`
    SELECT id, kind, status, "recordsFound", "recordsSaved", "recordsUpdated", "recordsQuarantined"
    FROM "ProcessingRun" 
    ORDER BY "createdAt" DESC 
    LIMIT 1
  `);
  console.log(JSON.stringify(runs.rows[0]));
  
  console.log('\n=== EXTERNAL IDENTITY SAMPLES ===');
  const identities=await client.query(`
    SELECT namespace, COUNT(*) as cnt 
    FROM "ExternalIdentity" 
    GROUP BY namespace
  `);
  console.log(JSON.stringify(identities.rows));
  
}finally{
  await client.end();
}
