import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { echoTikAccountId, echoTikSyncContext, type EchoTikGroup } from './echoTikSyncContext.js';
import { acquireEchoTikSyncLock } from './echoTikSyncState.js';
import { beginEchoTikRequestBudget, endEchoTikRequestBudget, getQuotaStatus } from './echoTikQuotaService.js';
import { ingestEchoTikShopsFullDataset } from './echoTikShopFullIngestionService.js';
import { ingestEchoTikProductsFullDataset } from './echoTikProductFullIngestionService.js';
import { ingestEchoTikProductTrends } from './echoTikProductTrendIngestionService.js';
import { ingestEchoTikCategories } from './echoTikCategoryIngestionService.js';
import { pool } from '../../config/db.js';
import type { PoolClient } from 'pg';

export const ECHOTIK_GROUP_REQUEST_LIMIT = 15;
export const ECHOTIK_GROUP_ENDPOINTS: Record<EchoTikGroup, string[]> = {
  shops: ['/api/v3/echotik/seller/list'],
  products: ['/api/v3/echotik/product/list'],
  trends: ['/api/v3/echotik/product/trend'],
  categories: ['/api/v3/echotik/category/l1', '/api/v3/echotik/category/l2'],
};

export interface GroupSyncReport {
  group: EchoTikGroup;
  runId: string;
  endpoints: string[];
  requestsUsed: number;
  requestsReserved: number;
  requestsMax: number;
  pages: number;
  received: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  quotaRemaining: number | null;
  status: 'NO_CHANGES' | 'SUCCESS' | 'FAILED' | 'LIMIT_REACHED' | 'BLOCKED';
  errors: string[];
  startedAt: string;
  finishedAt?: string;
}

// Exactly one selected ingestion function; no group can fall through to full sync.
export async function ingestEchoTikGroup(group: EchoTikGroup, handlers = {
  shops: ingestEchoTikShopsFullDataset, products: ingestEchoTikProductsFullDataset,
  trends: ingestEchoTikProductTrends, categories: ingestEchoTikCategories,
}) {
  switch (group) {
    case 'shops': return handlers.shops(15, 10);
    case 'products': return handlers.products(15, 10);
    case 'trends': {
      const result = await handlers.trends(Number.MAX_SAFE_INTEGER);
      return { ...result, received: result.recordsReceived, failed: result.errors.length };
    }
    case 'categories': {
      const result = await handlers.categories();
      return { ...result, received: result.received, created: result.l1Created + result.l2Created,
        updated: result.l1Updated + result.l2Updated, skipped: result.skipped };
    }
  }
}

export async function runEchoTikGroupSync(group: EchoTikGroup): Promise<GroupSyncReport> {
  if (!Object.hasOwn(ECHOTIK_GROUP_ENDPOINTS, group)) throw new Error('Unsupported EchoTik group');
  const runId = randomUUID();
  const report: GroupSyncReport = {
    group, runId, endpoints: ECHOTIK_GROUP_ENDPOINTS[group], requestsUsed: 0, requestsReserved: 0, requestsMax: 15,
    pages: 0, received: 0, created: 0, updated: 0, skipped: 0, failed: 0,
    quotaRemaining: null, status: 'BLOCKED', errors: [], startedAt: new Date().toISOString(),
  };
  const directory = resolve(process.cwd(), 'data', 'echotik', 'accounts', echoTikAccountId, group, 'runs');
  let release: (() => Promise<void>) | undefined;
  let budget: Awaited<ReturnType<typeof beginEchoTikRequestBudget>> | undefined;
  let connection: PoolClient | undefined;
  let databaseLocked = false;
  let successfulPages = 0;
  try {
    connection = await pool.connect();
    databaseLocked = (await connection.query('SELECT pg_try_advisory_lock(73194, 15001) AS locked')).rows[0]?.locked === true;
    if (!databaseLocked) throw new Error('Another EchoTik sync holds the database lock');
    release = await acquireEchoTikSyncLock();
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${runId}.started.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
    budget = await beginEchoTikRequestBudget(15);
    const result = await echoTikSyncContext.run({
      group, runId,
      recordRequest: async (entry) => {
        await appendFile(resolve(directory, `${runId}.requests.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8');
        if (entry.phase === 'dispatch') report.requestsUsed += 1;
        if (entry.phase === 'response' && typeof entry.httpStatus === 'number' && entry.httpStatus >= 200 && entry.httpStatus < 300) successfulPages += 1;
      },
    }, () => ingestEchoTikGroup(group));
    report.pages = successfulPages;
    report.received = result.received;
    report.created = result.created;
    report.updated = result.updated;
    report.skipped = result.skipped;
    report.failed = result.failed;
    report.errors = result.errors;
    report.status = result.failed > 0 || result.errors.length > 0 ? 'FAILED'
      : budget.remaining === 0 ? 'LIMIT_REACHED'
      : result.created + result.updated > 0 ? 'SUCCESS' : 'NO_CHANGES';
  } catch (error) {
    report.status = budget ? 'FAILED' : 'BLOCKED';
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    report.requestsReserved = budget?.used ?? 0;
    report.pages = successfulPages;
    report.finishedAt = new Date().toISOString();
    if (release) {
      try {
        report.quotaRemaining = (await getQuotaStatus()).remainingThisMonth;
        await writeFile(resolve(directory, `${runId}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
      } catch (error) {
        report.status = 'FAILED';
        report.errors.push(`Could not persist final report: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (budget) endEchoTikRequestBudget();
        await release().catch((error) => { report.status = 'FAILED'; report.errors.push(`Lock release failed: ${String(error)}`); });
      }
    }
    if (connection) {
      try { if (databaseLocked) await connection.query('SELECT pg_advisory_unlock(73194, 15001)'); }
      finally { connection.release(); }
    }
  }
  return report;
}
