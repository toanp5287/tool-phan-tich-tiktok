import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EchoTikRequestBudget, sendOnceWithReservation } from '../dist/services/echotik/echoTikRequestBudget.js';
import { createEchoTikSyncState } from '../dist/services/echotik/echoTikSyncState.js';
import { loadEchoTikPage, ingestAndCheckpoint } from '../dist/services/echotik/echoTikPageRunner.js';
import { hasNextEchoTikPage, hasPersistedEchoTikRecords } from '../dist/services/echotik/echoTikSyncRules.js';
import { echoTikRawKey } from '../dist/services/echotik/echoTikSyncContext.js';

const createOfflineState = (root) => createEchoTikSyncState(root, async () => {});

test('50 reservations succeed; request 51 is blocked, including parallel callers', async () => {
  const budget = new EchoTikRequestBudget(50, 0);
  let recorded = 0;
  await Promise.all(Array.from({ length: 50 }, () => budget.reserve(async () => { recorded += 1; })));
  await assert.rejects(budget.reserve(async () => { recorded += 1; }), /budget exhausted/);
  assert.equal(recorded, 50);
  assert.equal(budget.used, 50);
  assert.equal(budget.remaining, 0);
});

test('pagination only continues after a full page and success requires saved records', () => {
  assert.equal(hasNextEchoTikPage(10, 10), true);
  assert.equal(hasNextEchoTikPage(9, 10), false);
  assert.equal(hasPersistedEchoTikRecords([0, 0, 1]), true);
  assert.equal(hasPersistedEchoTikRecords([0, -1]), false);
});

test('failed HTTP attempt is reserved before send and is not retried', async () => {
  const budget = new EchoTikRequestBudget(50, 0);
  let persisted = 0;
  let sends = 0;
  await assert.rejects(sendOnceWithReservation(
    () => budget.reserve(async () => { persisted += 1; }),
    async () => { sends += 1; throw new Error('HTTP 401'); },
  ), /HTTP 401/);
  assert.equal(persisted, 1);
  assert.equal(sends, 1);
  assert.equal(budget.used, 1);
});

test('sync lock rejects concurrent sessions and releases for a later run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-lock-'));
  try {
    const state = createOfflineState(root);
    const release = await state.acquireEchoTikSyncLock();
    await assert.rejects(state.acquireEchoTikSyncLock(), /already running/);
    await release();
    const releaseAgain = await state.acquireEchoTikSyncLock();
    await releaseAgain();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sync lock rejects two simultaneous acquisition attempts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-lock-race-'));
  try {
    const state = createOfflineState(root);
    const results = await Promise.allSettled([state.acquireEchoTikSyncLock(), state.acquireEchoTikSyncLock()]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    const release = results.find((result) => result.status === 'fulfilled').value;
    await release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stale lock recovery preserves resumable page checkpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-stale-lock-'));
  try {
    const state = createOfflineState(root);
    await writeFile(join(root, 'sync.lock'), '2147483647\nold\n');
    await state.markEchoTikPageComplete('shop-list:1:10');
    const release = await state.acquireEchoTikSyncLock();
    assert.equal(await state.isEchoTikPageComplete('shop-list:1:10'), true);
    await release();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('completed page is skipped and pending raw response resumes without refetch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-resume-'));
  try {
    const state = createOfflineState(root);
    let fetches = 0;
    const key = 'shop-list:1:10';
    const first = await loadEchoTikPage({
      key,
      isComplete: state.isEchoTikPageComplete,
      readCached: state.getEchoTikCachedResponse,
      fetch: async () => { fetches += 1; return { data: [{ id: '1' }] }; },
      saveRaw: async (cacheKey, response) => { await state.saveEchoTikRawResponse('seller-list', 1, response, cacheKey); },
    });
    assert.equal(first.wasCached, false);
    const resumed = await loadEchoTikPage({
      key,
      isComplete: state.isEchoTikPageComplete,
      readCached: state.getEchoTikCachedResponse,
      fetch: async () => { fetches += 1; throw new Error('must not fetch'); },
      saveRaw: async () => { throw new Error('already persisted'); },
    });
    assert.equal(resumed.wasCached, true);
    let ingested = 0;
    await ingestAndCheckpoint(resumed.response, async (response) => { ingested += response.data.length; }, () => state.markEchoTikPageComplete(key));
    assert.equal(fetches, 1);
    assert.equal(ingested, 1);
    const skipped = await loadEchoTikPage({ key, isComplete: state.isEchoTikPageComplete, readCached: state.getEchoTikCachedResponse, fetch: async () => { fetches += 1; return {}; }, saveRaw: async () => {} });
    assert.equal(skipped.skipped, true);
    assert.equal(fetches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('API failure is attempted once and is not retried', async () => {
  let attempts = 0;
  await assert.rejects(loadEchoTikPage({
    key: 'product-list:1:10', isComplete: async () => false, readCached: async () => null,
    fetch: async () => { attempts += 1; throw new Error('mock API error'); },
    saveRaw: async () => {},
  }), /mock API error/);
  assert.equal(attempts, 1);
});

test('raw JSON write failure prevents ingestion and next page work', async () => {
  let ingested = 0;
  let fetched = 0;
  await assert.rejects(loadEchoTikPage({
    key: 'shop-list:1:10', isComplete: async () => false, readCached: async () => null,
    fetch: async () => { fetched += 1; return { data: [] }; },
    saveRaw: async () => { throw new Error('disk full'); },
  }), /disk full/);
  assert.equal(fetched, 1);
  assert.equal(ingested, 0);
});

test('raw response files are unique and preserve the complete response body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-raw-'));
  try {
    const state = createOfflineState(root);
    const response = { data: [{ seller_id: 's1', nested: { unchanged: true } }], code: 0 };
    const [a, b] = await Promise.all([
      state.saveEchoTikRawResponse('seller-list', 1, response, 'seller-list:1:10'),
      state.saveEchoTikRawResponse('seller-list', 1, response),
    ]);
    assert.notEqual(a, b);
    const cached = await state.getEchoTikCachedResponse('seller-list:1:10');
    assert.deepEqual(cached, response);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('PostgreSQL raw-response failure retains disk JSON and blocks page checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-raw-db-fail-'));
  try {
    let dbAttempts = 0;
    const state = createEchoTikSyncState(root, async () => {
      dbAttempts += 1;
      if (dbAttempts === 1) throw new Error('mock PostgreSQL failure');
    });
    const key = 'seller-list:1:10';
    await assert.rejects(state.saveEchoTikRawResponse('seller-list', 1, { data: [] }, key), /mock PostgreSQL failure/);
    assert.equal(await state.isEchoTikPageComplete(key), false);
    const resumed = await state.getEchoTikCachedResponse(key);
    assert.deepEqual(resumed, { data: [] });
    assert.equal(dbAttempts, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('PostgreSQL failure leaves cached raw response resumable and uncheckpointed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-db-fail-'));
  try {
    const state = createOfflineState(root);
    const key = 'product-list:1:10';
    let fetches = 0;
    const deps = {
      key,
      isComplete: state.isEchoTikPageComplete,
      readCached: state.getEchoTikCachedResponse,
      fetch: async () => { fetches += 1; return { data: [{ product_id: 'p1' }] }; },
      saveRaw: async (cacheKey, response) => { await state.saveEchoTikRawResponse('product-list', 1, response, cacheKey); },
    };
    const page = await loadEchoTikPage(deps);
    await assert.rejects(ingestAndCheckpoint(page.response, async () => { throw new Error('database unavailable'); }, () => state.markEchoTikPageComplete(key)), /database unavailable/);
    assert.equal(await state.isEchoTikPageComplete(key), false);
    const retry = await loadEchoTikPage({ ...deps, fetch: async () => { fetches += 1; throw new Error('must resume raw'); } });
    assert.equal(retry.wasCached, true);
    assert.equal(fetches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source-scoped dedupe preserves the same platform ID from distinct sources', () => {
  const rows = new Map();
  const upsert = (id, source, name) => rows.set(`${id}:${source}`, { id, source, name });
  upsert('shop-1', 'apify', 'legacy');
  upsert('shop-1', 'echotik', 'echo');
  upsert('shop-1', 'echotik', 'echo-updated');
  assert.equal(rows.size, 2);
  assert.equal(rows.get('shop-1:apify').name, 'legacy');
  assert.equal(rows.get('shop-1:echotik').name, 'echo-updated');
});

test('corrupt progress state fails closed rather than refetching completed pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'echotik-state-corrupt-'));
  try {
    await writeFile(join(root, 'sync-progress.json'), '{broken');
    const state = createEchoTikSyncState(root);
    await assert.rejects(state.isEchoTikPageComplete('seller-list:1:10'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('per-run cap of 15 blocks request 16 while keeping the monthly limit separate', async () => {
  const budget = new EchoTikRequestBudget(50, 0, 15);
  let recorded = 0;
  for (let index = 0; index < 15; index += 1) {
    await budget.reserve(async () => { recorded += 1; });
  }
  await assert.rejects(budget.reserve(async () => { recorded += 1; }), /budget exhausted/);
  assert.equal(recorded, 15);
  assert.equal(budget.used, 15);
  assert.equal(budget.remaining, 0);
});

test('the next run starts again at 15 requests without resetting monthly usage', () => {
  const secondRun = new EchoTikRequestBudget(50, 15, 15);
  assert.equal(secondRun.remaining, 15);
  const thirdRun = new EchoTikRequestBudget(50, 30, 15);
  assert.equal(thirdRun.remaining, 15);
  const exhaustedMonth = new EchoTikRequestBudget(50, 50, 15);
  assert.equal(exhaustedMonth.remaining, 0);
});

test('account and group scoped paths keep checkpoints and raw keys isolated', () => {
  const root = join(tmpdir(), 'echotik-root');
  assert.notEqual(
    join(root, 'accounts', 'account-a', 'shops'),
    join(root, 'accounts', 'account-b', 'shops'),
  );
  assert.equal(echoTikRawKey('account-a', 'shops', 'shop-list:1:10'), 'account-a:shops:shop-list:1:10');
  assert.notEqual(
    echoTikRawKey('account-a', 'shops', 'shop-list:1:10'),
    echoTikRawKey('account-b', 'shops', 'shop-list:1:10'),
  );
});
