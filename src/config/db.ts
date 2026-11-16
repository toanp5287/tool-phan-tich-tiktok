import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
// Archived writers must never reconnect to the legacy database after cutover.
throw new Error('LEGACY_DATABASE_DISABLED: use config/datasetDb.js; legacy access requires the archived application.');
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db');
const { Pool } = pg;

const globalForPrisma = globalThis as unknown as {
  __tiktokPool?: pg.Pool;
  __tiktokPrisma?: PrismaClient;
};

const pool =
  globalForPrisma.__tiktokPool ??
  new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'tiktok-ecommerce-analytics',
  });

pool.on('error', (error) => {
  logger.error('PostgreSQL pool gặp lỗi không mong đợi', error);
});

const adapter = new PrismaPg(pool);

const prisma =
  globalForPrisma.__tiktokPrisma ??
  new PrismaClient({
    adapter,
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.nodeEnv !== 'production') {
  globalForPrisma.__tiktokPool = pool;
  globalForPrisma.__tiktokPrisma = prisma;
}

export async function checkDatabaseConnection(): Promise<void> {
  await pool.query('SELECT 1');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect().catch((error) => logger.warn('Không thể đóng Prisma Client', error));
  await pool.end().catch((error) => logger.warn('Không thể đóng PostgreSQL pool', error));
}

export { pool };
export default prisma;
