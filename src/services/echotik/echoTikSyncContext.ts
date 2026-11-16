import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { resolve } from 'node:path';

export type EchoTikGroup = 'shops' | 'products' | 'trends' | 'categories';
export const echoTikAccountId = createHash('sha256')
  .update(`${env.echotik.baseUrl.trim().toLowerCase()}\0${env.echotik.username.trim().toLowerCase()}`).digest('hex');
export const echoTikGroupRoot = (root: string, account: string, group: string) => resolve(root, 'accounts', account, group);
export const echoTikRawKey = (account: string, group: string, key: string) => `${account}:${group}:${key}`;
export const echoTikSyncContext = new AsyncLocalStorage<{
  group: EchoTikGroup | 'demo';
  runId: string;
  recordRequest?: (entry: Record<string, unknown>) => Promise<void>;
}>();
