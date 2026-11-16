import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma, { pool } from '../../config/db.js';
import { getEchoTikClient } from './echoTikClient.js';
import { acquireEchoTikSyncLock } from './echoTikSyncState.js';
import { beginEchoTikRequestBudget, endEchoTikRequestBudget, getQuotaStatus } from './echoTikQuotaService.js';
import { echoTikAccountId, echoTikSyncContext } from './echoTikSyncContext.js';
import { chooseRelated, EXCLUDED_DEMO_PRODUCT, id, numeric, rows, text, type Row } from './echoTikDemoMapping.js';
import { persistDemo } from './echoTikDemoPersistence.js';
import { createDemoRequestRunner, type DemoRequest } from './echoTikDemoRequest.js';

interface DemoState {
  version: 1; account: string; batch: string; jobId: number; attempts: number; selectedProduct?: string; productId?: number;
  requests: Record<string, DemoRequest>;
}
export interface DemoOptions { batch: string; phase: 'discover' | 'collect'; productId?: string; maxRequests: number; keepReserve: number }
export function validateDemoOptions(options: DemoOptions) {
  if (!/^[a-zA-Z0-9-]{1,60}$/.test(options.batch)) throw new Error('Invalid batch identifier');
  if (!['discover', 'collect'].includes(options.phase)) throw new Error('Invalid phase');
  if (!Number.isSafeInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 10) throw new Error('Request cap must be 1–10');
  if (!Number.isSafeInteger(options.keepReserve) || options.keepReserve < 1) throw new Error('Keep at least one account request in reserve');
  if (options.phase === 'collect' && (!options.productId || id(options.productId) === EXCLUDED_DEMO_PRODUCT)) throw new Error('Choose a new product, not product 149');
}

// Never import this entry point from startup/schedulers. CLI execution requires explicit approval.
export async function collectDemo(options: DemoOptions) {
  validateDemoOptions(options);
  const connection = await pool.connect();
  let locked = false;
  let release: (() => Promise<void>) | undefined;
  let budgetStarted = false;
  try {
    locked = (await connection.query('SELECT pg_try_advisory_lock(73194,15001) AS locked')).rows[0]?.locked === true;
    if (!locked) throw new Error('Another EchoTik collection is active');
    release = await acquireEchoTikSyncLock();
    const root = resolve(process.cwd(), 'data', 'echotik', 'accounts', echoTikAccountId, 'demo', options.batch);
    const statePath = resolve(root, 'state.json');
    let state: DemoState;
    try {
      state = JSON.parse(await readFile(statePath, 'utf8')) as DemoState;
      if (state.version !== 1 || state.account !== echoTikAccountId || state.batch !== options.batch || !Number.isSafeInteger(state.jobId) || !Number.isSafeInteger(state.attempts) || state.attempts < 0 || state.attempts > 10 || !state.requests || typeof state.requests !== 'object' || Array.isArray(state.requests) || Object.keys(state.requests).length !== state.attempts) throw new Error('Invalid demo state; fail closed');
      const persistedJob = await prisma.scrapeJob.findFirst({ where: { id: state.jobId, source: 'echotik', jobType: 'ECHOTIK_DEMO', metadata: { path: ['batch'], equals: options.batch } } });
      if (!persistedJob) throw new Error('Demo checkpoint does not match collection job');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (options.phase !== 'discover') throw new Error('Run discovery first; no request sent');
      const old = await prisma.scrapeJob.findFirst({ where: { jobType: 'ECHOTIK_DEMO', metadata: { path: ['batch'], equals: options.batch } } });
      if (old) throw new Error('Batch exists but checkpoint is missing; do not reset its budget');
      const job = await prisma.scrapeJob.create({ data: { source: 'echotik', jobType: 'ECHOTIK_DEMO', status: 'RUNNING', startedAt: new Date(), metadata: { batch: options.batch } } });
      state = { version: 1, account: echoTikAccountId, batch: options.batch, jobId: job.id, attempts: 0, requests: {} };
    }
    await mkdir(root, { recursive: true });
    const save = async () => {
      const temporary = `${statePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { flag: 'wx' });
      await rename(temporary, statePath);
    };
    await save();
    const quota = await getQuotaStatus();
    const cap = Math.min(options.maxRequests, 10 - state.attempts, quota.remainingThisMonth - options.keepReserve);
    // Cached replay requires no request budget and remains possible at quota zero.
    if (cap > 0) { await beginEchoTikRequestBudget(cap); budgetStarted = true; }
    const client = getEchoTikClient();
    const rawKeys: string[] = [];
    const runner = createDemoRequestRunner(state, Math.max(0, cap), save, async (key, endpoint, response, capturedAt) => {
      const requestKey = `demo:${echoTikAccountId}:${options.batch}:${key}`;
      await prisma.echoTikRawResponse.upsert({ where: { requestKey }, create: { requestKey, endpoint, capturedAt: new Date(capturedAt), response: response as import('@prisma/client').Prisma.InputJsonValue }, update: {} });
    });
    const work = async () => {
      const call = async (key: string, endpoint: string, send: () => Promise<unknown>) => {
        const requestKey = `demo:${echoTikAccountId}:${options.batch}:${key}`;
        const response = await runner.call(key, endpoint, send);
        rawKeys.push(requestKey);
        return rows(response);
      };
      const previous = await prisma.intelligenceObservation.findFirst({ where: { scrapeJobId: state.jobId, kind: 'PRODUCT' } });
      if (previous) {
        state.productId = previous.productId; await save();
        await prisma.scrapeJob.update({ where: { id: state.jobId }, data: { status: 'COMPLETED', finishedAt: new Date() } });
        return { phase: 'COMPLETED', productId: state.productId, requestsReserved: state.attempts };
      }
      const candidates = await call('candidates', '/api/v3/echotik/product/list', () => client.getDemoCandidates());
      const existing = await prisma.product.findMany({ where: { platformProductId: { in: candidates.map((row) => id(row.product_id)) } }, select: { platformProductId: true } });
      const known = new Set(existing.map((row) => row.platformProductId));
      const eligible = candidates.filter((row) => id(row.product_id) !== EXCLUDED_DEMO_PRODUCT && !known.has(id(row.product_id)) && row.region === 'VN' && row.seller_id != null && Number(numeric(row.total_ifl_cnt) ?? 0) >= 3 && Number(numeric(row.total_video_cnt) ?? 0) >= 2);
      if (options.phase === 'discover') {
        await prisma.scrapeJob.update({ where: { id: state.jobId }, data: { status: 'PARTIAL', metadata: { batch: options.batch, phase: 'AWAITING_SELECTION', requestReservations: state.attempts } } });
        return { phase: 'AWAITING_SELECTION', batch: options.batch, requestsReserved: state.attempts, candidates: eligible.map((row) => ({ platformProductId: id(row.product_id), name: text(row.product_name), sellerId: id(row.seller_id), creatorCount: row.total_ifl_cnt, videoCount: row.total_video_cnt, relationshipsVerified: false })) };
      }
      const productId = options.productId!;
      if (state.selectedProduct && state.selectedProduct !== productId) throw new Error('This batch is already bound to another product');
      if (!eligible.some((row) => id(row.product_id) === productId)) throw new Error('Product is not an eligible new candidate');
      state.selectedProduct = productId; await save();
      const videos = await call('videos', '/api/v3/echotik/product/video/list', () => client.getDemoData('product/video/list', [productId]));
      const creators = await call('creators', '/api/v3/echotik/product/influencer/list', () => client.getDemoData('product/influencer/list', [productId]));
      const selected = chooseRelated(videos, creators, productId);
      const products = await call('product', '/api/v3/echotik/product/detail', () => client.getDemoData('product/detail', [productId]));
      const product = products.find((row) => id(row.product_id) === productId);
      if (!product) throw new Error('Selected product detail is absent');
      const candidate = eligible.find((row) => id(row.product_id) === productId)!;
      if (id(candidate.seller_id) !== id(product.seller_id)) throw new Error('Product seller changed between endpoints');
      const sellerId = id(product.seller_id);
      const shops = await call('shop', '/api/v3/echotik/seller/detail', () => client.getDemoData('seller/detail', [sellerId]));
      const shop = shops.find((row) => id(row.seller_id) === sellerId);
      if (!shop) throw new Error('Linked shop detail is absent');
      const creatorDetails = await call('creator-details', '/api/v3/echotik/influencer/detail', () => client.getDemoData('influencer/detail', selected.creators.map((row) => id(row.user_id))));
      const videoDetails = await call('video-details', '/api/v3/echotik/video/detail', () => client.getDemoData('video/detail', selected.videos.map((row) => id(row.video_id))));
      const capturedAt = new Date();
      state.productId = await persistDemo(state.jobId, { product, shop, ...selected, creatorDetails, videoDetails, capturedAt, rawRequestKeys: rawKeys });
      await save();
      await prisma.scrapeJob.update({ where: { id: state.jobId }, data: { status: 'COMPLETED', finishedAt: capturedAt, recordsSaved: 7, metadata: { batch: options.batch, productId: state.productId, externalProductId: productId, selectedVideoIds: selected.videos.map((row) => id(row.video_id)), selectedCreatorIds: selected.creators.map((row) => id(row.user_id)), requestReservations: state.attempts } } });
      return { phase: 'COMPLETED', productId: state.productId, requestsReserved: state.attempts };
    };
    try {
      return await echoTikSyncContext.run({ group: 'demo', runId: options.batch, recordRequest: runner.record }, work);
    } catch (error) {
      await prisma.scrapeJob.update({ where: { id: state.jobId }, data: { status: 'FAILED', errorMessage: 'Demo stopped. Inspect durable request checkpoint; no automatic retries.', recordsFound: state.attempts } });
      throw error;
    }
  } finally {
    if (budgetStarted) endEchoTikRequestBudget();
    try { if (release) await release(); } finally {
      try { if (locked) await connection.query('SELECT pg_advisory_unlock(73194,15001)'); } finally { connection.release(); }
    }
  }
}
