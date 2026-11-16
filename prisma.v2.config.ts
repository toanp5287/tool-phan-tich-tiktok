import 'dotenv/config';
import { defineConfig } from 'prisma/config';
if (!process.env.NEW_DATABASE_URL) throw new Error('NEW_DATABASE_URL is required; legacy DATABASE_URL is never used for v2 migrations.');
export default defineConfig({ schema: 'prisma/schema.prisma', migrations: { path: 'prisma/migrations-v2' }, datasource: { url: process.env.DATASET_MIGRATION_URL ?? process.env.NEW_DATABASE_URL } });
