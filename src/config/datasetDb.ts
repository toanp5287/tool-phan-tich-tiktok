import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/v2/index.js';
if (!process.env.NEW_DATABASE_URL) throw new Error('NEW_DATABASE_URL is required. Legacy fallback is prohibited.');
const url = new URL(process.env.NEW_DATABASE_URL);
if (decodeURIComponent(url.pathname.slice(1)) !== 'tiktok_datasets_v2') throw new Error('Unexpected dataset database; refuse startup.');
export const datasetPool = new pg.Pool({ connectionString: url.toString(), max: 10, application_name: 'tiktok-dataset-v2' });
export const datasetDb = new PrismaClient({ adapter: new PrismaPg(datasetPool) });
export async function verifyDatasetDatabase() {
  const result = await datasetPool.query("SELECT current_database() AS name, obj_description('public'::regnamespace) AS generation");
  if (result.rows[0]?.name !== 'tiktok_datasets_v2' || result.rows[0]?.generation !== 'TikTok dataset database v2; no legacy data') throw new Error('Dataset database generation mismatch');
}
