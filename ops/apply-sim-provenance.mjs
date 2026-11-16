import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const migrationName = '20261112090000_add_simulation_entity_provenance';
const migrationPath = new URL(`../prisma/migrations-v2/${migrationName}/migration.sql`, import.meta.url);
const sql = await readFile(migrationPath, 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
const url = process.env.DATASET_MIGRATION_URL ?? process.env.NEW_DATABASE_URL;
if (!url) throw new Error('DATASET_MIGRATION_URL or NEW_DATABASE_URL is required');
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, query_timeout: 60000 });

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(sql);
  const existing = await client.query('SELECT id FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL LIMIT 1', [migrationName]);
  if (existing.rowCount === 0) {
    await client.query(
      'INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES ($1,$2,now(),$3,NULL,NULL,now(),1)',
      [randomUUID(), checksum, migrationName],
    );
  }
  await client.query('COMMIT');
  const verify = await client.query(`
    SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name IN ('Shop','Creator','ProductShop','ProductCreator','CreatorShop')
      AND column_name IN ('isSimulated','simulationKey','simulationMetadata')
    ORDER BY table_name,column_name
  `);
  console.log(JSON.stringify({ migrationName, columns: verify.rows }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}
