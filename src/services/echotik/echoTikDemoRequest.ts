export interface DemoRequest {
  endpoint: string; phase: string; response?: unknown; capturedAt?: string;
  events?: Array<{ phase: string; timestamp: string; httpStatus?: number }>;
}
export interface DemoCheckpoint { attempts: number; requests: Record<string, DemoRequest> }

export function createDemoRequestRunner(
  state: DemoCheckpoint, additionalLimit: number, save: () => Promise<void>,
  persist: (key: string, endpoint: string, response: unknown, capturedAt: string) => Promise<void>,
) {
  let used = 0;
  let activeKey = '';
  return {
    async record(entry: Record<string, unknown>) {
      const request = state.requests[activeKey];
      if (!request) throw new Error('No demo request intent');
      request.phase = String(entry.phase);
      request.events ??= [];
      request.events.push({ phase: String(entry.phase), timestamp: String(entry.timestamp), ...(typeof entry.httpStatus === 'number' ? { httpStatus: entry.httpStatus } : {}) });
      await save();
    },
    async call(key: string, endpoint: string, send: () => Promise<unknown>) {
      activeKey = key;
      const cached = state.requests[key];
      if (cached?.response !== undefined) {
        if (!cached.capturedAt || cached.endpoint !== endpoint) throw new Error('Invalid cached response');
        await persist(key, endpoint, cached.response, cached.capturedAt);
        return cached.response;
      }
      if (cached) throw new Error('Previous request outcome is uncertain/failed; automatic resend is blocked');
      if (!Number.isSafeInteger(state.attempts) || state.attempts < 0 || state.attempts >= 10 || used >= additionalLimit) throw new Error('Demo request budget exhausted');
      state.attempts += 1; used += 1;
      state.requests[key] = { endpoint, phase: 'intent' };
      await save();
      const response = await send();
      const capturedAt = new Date().toISOString();
      state.requests[key] = { ...state.requests[key]!, phase: 'response', response, capturedAt };
      await save();
      await persist(key, endpoint, response, capturedAt);
      return response;
    },
  };
}
