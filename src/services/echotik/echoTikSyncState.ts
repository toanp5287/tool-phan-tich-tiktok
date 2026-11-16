import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import prisma from '../../config/db.js';
import { Prisma } from '@prisma/client';
import { echoTikAccountId, echoTikSyncContext, echoTikGroupRoot, echoTikRawKey } from './echoTikSyncContext.js';

interface SyncState {
  completedPages: string[];
  terminalPageKeys: string[];
  pendingResponses: Record<string, string>;
  completedResponses: Record<string, string>;
  pendingWork: string[];
  syncDate?: string;
  lastError?: string;
  updatedAt?: string;
}

export function createEchoTikSyncState(
  root: string,
  persistRawResponse: (input: { requestKey: string; endpoint: string; page: number | null; response: unknown }) => Promise<void> = async (input) => {
    await prisma.echoTikRawResponse.upsert({
      where: { requestKey: input.requestKey },
      create: {
        ...input,
        source: 'echotik',
        response: input.response as Prisma.InputJsonValue,
      },
      update: {},
    });
  },
) {
  const statePath = resolve(root, 'sync-progress.json');
  const lockPath = resolve(root, 'sync.lock');
  const rawDirectory = resolve(root, 'raw');

  async function readState(): Promise<SyncState> {
    try {
      const value = JSON.parse(await readFile(statePath, 'utf8')) as Partial<SyncState>;
      if (!Array.isArray(value.completedPages) || value.completedPages.some((key) => typeof key !== 'string')) {
        throw new Error('Invalid EchoTik sync progress file');
      }
      return {
        completedPages: value.completedPages,
        terminalPageKeys: value.terminalPageKeys ?? [],
        pendingResponses: value.pendingResponses ?? {},
        completedResponses: value.completedResponses ?? {},
        pendingWork: value.pendingWork ?? [],
        ...(value.syncDate ? { syncDate: value.syncDate } : {}),
        ...(value.lastError ? { lastError: value.lastError } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { completedPages: [], terminalPageKeys: [], pendingResponses: {}, completedResponses: {}, pendingWork: [] };
      }
      throw error;
    }
  }

  async function writeState(state: SyncState): Promise<void> {
    await mkdir(root, { recursive: true });
    const temp = `${statePath}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, { flag: 'wx' });
    await rename(temp, statePath);
  }

  async function isEchoTikPageComplete(key: string): Promise<boolean> {
    return (await readState()).completedPages.includes(key);
  }

  async function getNextEchoTikPage(prefix: string, pageSize: number): Promise<number> {
    let page = 1;
    const state = await readState();
    while (state.completedPages.includes(`${prefix}:${page}:${pageSize}`)) page += 1;
    return page;
  }

  async function markEchoTikPageComplete(key: string, terminal = false): Promise<void> {
    const state = await readState();
    if (!state.completedPages.includes(key)) state.completedPages.push(key);
    if (terminal && !state.terminalPageKeys.includes(key)) state.terminalPageKeys.push(key);
    if (state.pendingResponses[key]) state.completedResponses[key] = state.pendingResponses[key];
    delete state.pendingResponses[key];
    state.pendingWork = state.pendingWork.filter((item) => item !== key);
    delete state.lastError;
    await writeState(state);
  }

  async function markEchoTikPagePending(key: string): Promise<void> {
    const state = await readState();
    if (!state.pendingWork.includes(key)) state.pendingWork.push(key);
    await writeState(state);
  }

  async function getEchoTikPendingPages(prefix: string): Promise<string[]> {
    return (await readState()).pendingWork.filter((key) => key.startsWith(`${prefix}:`));
  }

  async function getOrCreateEchoTikSyncDate(): Promise<string> {
    const state = await readState();
    if (!state.syncDate) {
      state.syncDate = new Date().toISOString().slice(0, 10);
      await writeState(state);
    }
    return state.syncDate;
  }

  async function isBeyondEchoTikTerminalPage(prefix: string, page: number, pageSize: number): Promise<boolean> {
    const state = await readState();
    return state.terminalPageKeys.some((key) => {
      const match = key.match(new RegExp(`^${prefix}:(\\d+):${pageSize}$`));
      return match !== null && Number(match[1]) < page;
    });
  }

  async function recordEchoTikSyncError(error: unknown): Promise<void> {
    const state = await readState();
    state.lastError = error instanceof Error ? error.message : String(error);
    await writeState(state);
  }

  async function getEchoTikCachedResponse(key: string): Promise<unknown | null> {
    const state = await readState();
    let path = state.pendingResponses[key] ?? state.completedResponses[key];
    if (!path) {
      let entries: string[];
      try { entries = await readdir(rawDirectory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const prefix = `${key.replaceAll(':', '-').replace(/[^a-z0-9-]/gi, '-')}-`;
      const name = entries.filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json')).sort().at(-1);
      if (!name) return null;
      path = resolve(rawDirectory, name);
      state.pendingResponses[key] = path;
      await writeState(state);
    }
    const response = JSON.parse(await readFile(path, 'utf8')) as unknown;
    await persistRawResponse({ requestKey: key, endpoint: key.split(':')[0] ?? 'unknown', page: null, response });
    return response;
  }

  async function saveEchoTikRawResponse(endpoint: string, page: number | null, response: unknown, cacheKey?: string): Promise<string> {
    await mkdir(rawDirectory, { recursive: true });
    const keyName = cacheKey?.replace(/[^a-z0-9-]/gi, '-');
    const name = keyName ?? (endpoint.replace(/[^a-z0-9-]/gi, '-') + (page === null ? '' : `-page${page}`));
    const path = resolve(rawDirectory, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
    await writeFile(path, `${JSON.stringify(response, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    if (cacheKey) {
      const state = await readState();
      state.pendingResponses[cacheKey] = path;
      delete state.completedResponses[cacheKey];
      await writeState(state);
      try {
        await persistRawResponse({ requestKey: cacheKey, endpoint, page, response });
      } catch (error) {
        await recordEchoTikSyncError(error).catch(() => undefined);
        throw new Error(`Raw EchoTik response is saved at ${path}, but PostgreSQL raw-response persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return path;
  }

  async function acquireEchoTikSyncLock(): Promise<() => Promise<void>> {
    await mkdir(dirname(lockPath), { recursive: true });
    let file;
    try {
      file = await open(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const [pidText] = await readFile(lockPath, 'utf8').then((text) => text.split(/\r?\n/));
      const pid = Number(pidText);
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('EchoTik sync lock exists and is unreadable; verify no sync is running before manual cleanup');
      try {
        process.kill(pid, 0);
        throw new Error(`EchoTik sync is already running (pid ${pid})`);
      } catch (probeError) {
        if (probeError instanceof Error && probeError.message.startsWith('EchoTik sync is already running')) throw probeError;
        if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError;
      }
      const stalePath = `${lockPath}.stale-${randomUUID()}`;
      try {
        await rename(lockPath, stalePath);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('EchoTik sync lock changed during stale-lock recovery; retry the sync command');
        }
        throw renameError;
      }
      file = await open(lockPath, 'wx');
      await unlink(stalePath).catch(() => undefined);
    }
    try { await file.writeFile(`${process.pid}\n${new Date().toISOString()}\n`); }
    finally { await file.close(); }
    return async () => unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  return {
    getNextEchoTikPage,
    isEchoTikPageComplete,
    markEchoTikPageComplete,
    markEchoTikPagePending,
    getEchoTikPendingPages,
    getOrCreateEchoTikSyncDate,
    isBeyondEchoTikTerminalPage,
    recordEchoTikSyncError,
    getEchoTikCachedResponse,
    saveEchoTikRawResponse,
    acquireEchoTikSyncLock,
  };
}

function currentState() {
  const group = echoTikSyncContext.getStore()?.group ?? 'full';
  return createEchoTikSyncState(echoTikGroupRoot(resolve(process.cwd(), 'data', 'echotik'), echoTikAccountId, group), async (input) => {
    await prisma.echoTikRawResponse.upsert({
      where: { requestKey: echoTikRawKey(echoTikAccountId, group, input.requestKey) },
      create: { ...input, requestKey: echoTikRawKey(echoTikAccountId, group, input.requestKey), source: 'echotik', response: input.response as Prisma.InputJsonValue },
      update: {},
    });
  });
}
export const isEchoTikPageComplete = (key: string) => currentState().isEchoTikPageComplete(key);
export const getNextEchoTikPage = (prefix: string, size: number) => currentState().getNextEchoTikPage(prefix, size);
export const markEchoTikPageComplete = (key: string, terminal = false) => currentState().markEchoTikPageComplete(key, terminal);
export const isBeyondEchoTikTerminalPage = (prefix: string, page: number, size: number) => currentState().isBeyondEchoTikTerminalPage(prefix, page, size);
export const recordEchoTikSyncError = (error: unknown) => currentState().recordEchoTikSyncError(error);
export const getEchoTikCachedResponse = (key: string) => currentState().getEchoTikCachedResponse(key);
export const saveEchoTikRawResponse = (endpoint: string, page: number | null, response: unknown, key?: string) => currentState().saveEchoTikRawResponse(endpoint, page, response, key);
// One lock across all accounts/groups: quota reservation and checkpoint writers cannot overlap.
export const acquireEchoTikSyncLock = () => createEchoTikSyncState(resolve(process.cwd(), 'data', 'echotik', 'guarded-sync')).acquireEchoTikSyncLock();
export const getOrCreateEchoTikSyncDate = () => currentState().getOrCreateEchoTikSyncDate();
