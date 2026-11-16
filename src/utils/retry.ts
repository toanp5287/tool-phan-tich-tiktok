import { createLogger } from './logger.js';
import { toErrorMessage } from './errors.js';

const logger = createLogger('retry');

/** Lỗi được đánh dấu là có thể thử lại (mất mạng, rate limit, dataset rỗng...). */
export class RetryableError extends Error {
  readonly retryable = true;
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RetryableError';
    this.cause = cause;
  }
}

export interface RetryOptions {
  /** Số lần thử tối đa (bao gồm lần đầu). Mặc định 3. */
  maxAttempts?: number;
  /** Thời gian chờ tối thiểu giữa 2 lần thử (ms). Mặc định 5000. */
  minDelayMs?: number;
  /** Thời gian chờ tối đa giữa 2 lần thử (ms). Mặc định 10000. */
  maxDelayMs?: number;
  /** Nhãn dùng cho log. */
  label?: string;
  /** Quyết định lỗi nào được phép thử lại. */
  isRetryable?: (error: unknown) => boolean;
  /** Hook sau mỗi lần thất bại (trước khi sleep). */
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: unknown }) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Tính thời gian chờ theo exponential backoff + jitter, giới hạn trong [min,max].
 * Ví dụ min=5000, max=10000: lần 1 ~5s, lần 2 ~10s.
 */
export function computeBackoffDelay(
  attempt: number,
  minDelayMs = 5000,
  maxDelayMs = 10000,
): number {
  const safeMin = Math.max(0, minDelayMs);
  const safeMax = Math.max(safeMin, maxDelayMs);
  const exponential = safeMin * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.random() * 0.2 + 0.9; // 0.9 - 1.1
  return Math.min(safeMax, Math.round(exponential * jitter));
}

const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'APIFY_EMPTY_DATASET',
  'APIFY_EMPTY_RESULT',
  'APIFY_RATE_LIMITED',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /rate limit/i,
  /too many requests/i,
  /temporarily unavailable/i,
  /socket hang up/i,
  /network/i,
  /timed? ?out/i,
  /econnreset/i,
  /econnrefused/i,
  /eai_again/i,
  /enotfound/i,
  /aborted/i,
  /502|503|504/,
  /empty dataset/i,
];

/**
 * Lỗi KHÔNG BAO GIỜ retry: lỗi cấu hình/logic mang tính quyết định.
 * Retry chỉ tốn thời gian (và có thể tốn credit) mà không thể thành công.
 */
const NON_RETRYABLE_ERROR_CODES = new Set([
  'APIFY_NOT_CONFIGURED',
  'EMPTY_SHOP_KEYWORDS',
  'EMPTY_PROFILES',
  'EMPTY_TARGETS',
  'BAD_REQUEST',
  'UNAUTHORIZED',
]);

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableError) return true;

  const candidate = error as { code?: unknown; statusCode?: unknown; status?: unknown; message?: unknown } | null;
  if (!candidate) return false;

  if (typeof candidate.code === 'string' && NON_RETRYABLE_ERROR_CODES.has(candidate.code)) return false;

  if (typeof candidate.code === 'string' && RETRYABLE_ERROR_CODES.has(candidate.code)) return true;

  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : typeof candidate.status === 'number' ? candidate.status : null;
  if (status !== null && (status === 408 || status === 429 || status >= 500)) return true;

  const message = typeof candidate.message === 'string' ? candidate.message : String(error);
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Thực thi `operation` với cơ chế retry an toàn.
 * Không retry các lỗi logic không thể khắc phục (ví dụ 400, thiếu token).
 */
export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 3));
  const minDelayMs = options.minDelayMs ?? 5000;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const label = options.label ?? 'operation';
  const shouldRetry = options.isRetryable ?? isRetryableError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = shouldRetry(error);

      if (!retryable || attempt >= maxAttempts) {
        if (attempt >= maxAttempts && retryable) {
          logger.error(`[${label}] Thất bại sau ${attempt} lần thử`, toErrorMessage(error));
        }
        throw error;
      }

      const delayMs = computeBackoffDelay(attempt, minDelayMs, maxDelayMs);
      logger.warn(
        `[${label}] Lần thử ${attempt}/${maxAttempts} thất bại: ${toErrorMessage(error)}. Chờ ${Math.round(delayMs / 1000)}s rồi thử lại...`,
      );
      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error(`[${label}] Thất bại không rõ nguyên nhân`);
}
