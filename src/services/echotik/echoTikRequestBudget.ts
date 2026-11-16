/** In-process guard; PostgreSQL quota reservation is the cross-process authority. */
export class EchoTikRequestBudget {
  private reserved = 0;

  constructor(readonly limit: number, readonly initiallyUsed = 0, readonly runLimit = limit) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Request limit must be a positive integer');
    if (!Number.isSafeInteger(initiallyUsed) || initiallyUsed < 0) throw new Error('Initial usage must be non-negative');
    if (!Number.isSafeInteger(runLimit) || runLimit < 1) throw new Error('Run limit must be a positive integer');
  }

  get used(): number { return this.reserved; }
  get remaining(): number { return Math.max(0, Math.min(this.limit - this.initiallyUsed - this.reserved, this.runLimit - this.reserved)); }

  async reserve(recordBeforeRequest: () => Promise<void>): Promise<void> {
    if (this.remaining === 0) throw new Error(`EchoTik request budget exhausted (${this.limit} maximum)`);
    this.reserved += 1;
    try { await recordBeforeRequest(); }
    catch (error) { this.reserved -= 1; throw error; }
  }
}

let activeBudget: EchoTikRequestBudget | null = null;
export function setActiveEchoTikRequestBudget(budget: EchoTikRequestBudget | null): void { activeBudget = budget; }
export function getActiveEchoTikRequestBudget(): EchoTikRequestBudget | null { return activeBudget; }

export async function sendOnceWithReservation<T>(
  reserve: () => Promise<void>,
  send: () => Promise<T>,
): Promise<T> {
  await reserve();
  return send();
}

export async function withRequestBudget<T>(budget: EchoTikRequestBudget, work: () => Promise<T>): Promise<T> {
  setActiveEchoTikRequestBudget(budget);
  try { return await work(); }
  finally { setActiveEchoTikRequestBudget(null); }
}
