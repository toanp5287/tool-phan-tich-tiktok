export function hasNextEchoTikPage(received: number, pageSize: number): boolean {
  return received === pageSize;
}

export function hasPersistedEchoTikRecords(counts: readonly number[]): boolean {
  return counts.some((count) => Number.isSafeInteger(count) && count > 0);
}
