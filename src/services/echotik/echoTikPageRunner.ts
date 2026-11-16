export interface ResumablePageDependencies<TResponse> {
  key: string;
  isComplete(key: string): Promise<boolean>;
  readCached(key: string): Promise<TResponse | null>;
  fetch(): Promise<TResponse>;
  saveRaw(key: string, response: TResponse): Promise<void>;
  ingest(response: TResponse): Promise<void>;
  markComplete(key: string): Promise<void>;
}

export async function loadEchoTikPage<TResponse>(deps: Pick<ResumablePageDependencies<TResponse>, 'key' | 'isComplete' | 'readCached' | 'fetch' | 'saveRaw'>): Promise<{ skipped: boolean; response?: TResponse; wasCached: boolean }> {
  if (await deps.isComplete(deps.key)) return { skipped: true, wasCached: false };
  const cached = await deps.readCached(deps.key);
  if (cached !== null) return { skipped: false, response: cached, wasCached: true };
  const response = await deps.fetch();
  await deps.saveRaw(deps.key, response);
  return { skipped: false, response, wasCached: false };
}

export async function ingestAndCheckpoint<TResponse>(
  response: TResponse,
  ingest: (value: TResponse) => Promise<void>,
  markComplete: () => Promise<void>,
): Promise<void> {
  await ingest(response);
  await markComplete();
}

/** One attempt only: cache raw response before DB writes; checkpoint only after DB succeeds. */
export async function runResumablePage<TResponse>(deps: ResumablePageDependencies<TResponse>): Promise<'completed' | 'already-completed'> {
  if (await deps.isComplete(deps.key)) return 'already-completed';
  const cached = await deps.readCached(deps.key);
  const response = cached ?? await deps.fetch();
  if (cached === null) await deps.saveRaw(deps.key, response);
  await deps.ingest(response);
  await deps.markComplete(deps.key);
  return 'completed';
}
