import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { toErrorMessage } from '../utils/errors.js';
import { formatDuration } from '../utils/dates.js';
import { isShopScrapeRunning, runShopScrapePipeline } from './shopScrapeService.js';
import { setTaskLockCycle } from './scrapeTaskLock.js';

const logger = createLogger('continuous-scrape');

// ─── Defaults (có thể override qua biến môi trường) ──────────────────────────

const DEFAULT_INTERVAL_SECS = 43_200; // 12 giờ / chu kỳ (đồng bộ với node-cron)
const MAX_INTERVAL_SECS = 86_400;
const MIN_INTERVAL_SECS = 10;
/** Số lần thử lại 1 chu kỳ lỗi (giới hạn, có sleep — không retry vô hạn). */
const MAX_CYCLE_ATTEMPTS = 2;
const CYCLE_RETRY_DELAY_MS = 30_000;

export type CycleStrategy = 'shop';

export interface ContinuousScrapeOptions {
  /** Khoảng nghỉ giữa 2 chu kỳ (giây). Mặc định 900. */
  intervalSecs?: number;
  /** Số chu kỳ tối đa. 0 = vô hạn (mặc định). */
  maxCycles?: number;
  /** Chờ chu kỳ hiện tại hoàn tất trước khi dừng (mặc định true). */
  graceful?: boolean;
}

export interface CycleResult {
  cycle: number;
  strategy: CycleStrategy;
  found: number;
  saved: number;
  updated: number;
  failed: number;
  durationMs: number;
  ok: boolean;
  errorMessage?: string;
}

export interface ContinuousScrapeSummary {
  cycles: number;
  completedCycles: number;
  failedCycles: number;
  totalSaved: number;
  totalUpdated: number;
  totalFailed: number;
  durationMs: number;
  stoppedBy: 'signal' | 'maxCycles' | 'fatal';
}

// ─── Trạng thái điều khiển (module-level, dùng cho Ctrl + C) ─────────────────

let stopRequested = false;
let wakeUp: (() => void) | null = null;

export function requestStop(): void {
  stopRequested = true;
  const resume = wakeUp;
  wakeUp = null;
  resume?.();
}

export function isStopRequested(): boolean {
  return stopRequested;
}

/** Reset trạng thái — hữu ích cho test hoặc chạy lại nhiều lần trong 1 process. */
export function resetContinuousScrapeState(): void {
  stopRequested = false;
  wakeUp = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveIntervalSecs(override?: number): number {
  const raw = override ?? readPositiveIntEnv('SCRAPE_INTERVAL_SECS', DEFAULT_INTERVAL_SECS);
  if (raw <= 0) return DEFAULT_INTERVAL_SECS;
  return Math.min(Math.max(Math.trunc(raw), MIN_INTERVAL_SECS), MAX_INTERVAL_SECS);
}

function resolveMaxCycles(override?: number): number {
  const raw = override ?? readPositiveIntEnv('SCRAPE_MAX_CYCLES', 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.trunc(raw);
}

/**
 * Sleep có thể ngắt ngay lập tức bằng `requestStop()` (Ctrl + C).
 */
function interruptibleSleep(ms: number): Promise<void> {
  if (stopRequested || ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeUp = null;
      resolve();
    }, ms);

    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

/**
 * Thực thi 1 chu kỳ cào TikTok Shop.
 *
 * - Nếu phiên trước chưa kết thúc (task lock đang giữ) => bỏ qua chu kỳ này
 *   thay vì chồng chéo, tránh chi phí Apify kép.
 * - Lỗi chu kỳ được thử lại tối đa MAX_CYCLE_ATTEMPTS lần, có sleep giữa các lần.
 *   Không bao giờ retry vô hạn.
 */
async function runCycle(cycle: number): Promise<CycleResult> {
  const startedAt = Date.now();
  setTaskLockCycle(cycle);

  try {
    if (isShopScrapeRunning()) {
      logger.warn(`Chu kỳ #${cycle}: phiên cào TikTok Shop trước chưa kết thúc, bỏ qua chu kỳ này`);
      return {
        cycle,
        strategy: 'shop',
        found: 0,
        saved: 0,
        updated: 0,
        failed: 0,
        durationMs: Date.now() - startedAt,
        ok: true,
      };
    }

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_CYCLE_ATTEMPTS; attempt += 1) {
      try {
        const result = await runShopScrapePipeline({ trigger: 'cli' });

        if (result.jobId === 0) {
          // Không chiếm được task lock => coi như chu kỳ bỏ qua, không retry.
          logger.warn(`Chu kỳ #${cycle}: không chiếm được khóa tác vụ, bỏ qua`);
          return {
            cycle,
            strategy: 'shop',
            found: 0,
            saved: 0,
            updated: 0,
            failed: 0,
            durationMs: Date.now() - startedAt,
            ok: true,
          };
        }

        return {
          cycle,
          strategy: 'shop',
          found: result.found,
          saved: result.saved,
          updated: result.updated,
          failed: result.failed,
          durationMs: Date.now() - startedAt,
          ok: true,
        };
      } catch (error) {
        lastError = error;

        if (attempt < MAX_CYCLE_ATTEMPTS) {
          logger.warn(
            `Chu kỳ #${cycle} lỗi (lần ${attempt}/${MAX_CYCLE_ATTEMPTS}): ${toErrorMessage(error)}. Thử lại sau ${CYCLE_RETRY_DELAY_MS / 1000}s`,
          );
          await interruptibleSleep(CYCLE_RETRY_DELAY_MS);
        }
      }
    }

    return {
      cycle,
      strategy: 'shop',
      found: 0,
      saved: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorMessage: toErrorMessage(lastError),
    };
  } catch (error) {
    return {
      cycle,
      strategy: 'shop',
      found: 0,
      saved: 0,
      updated: 0,
      failed: 0,
      durationMs: Date.now() - startedAt,
      ok: false,
      errorMessage: toErrorMessage(error),
    };
  }
}

// ─── Vòng lặp chính ──────────────────────────────────────────────────────────

/**
 * Chạy cào TikTok Shop liên tục cho tới khi `requestStop()` được gọi (Ctrl + C).
 * Lỗi của một chu kỳ không làm dừng vòng lặp — chỉ ghi log và tiếp tục.
 */
export async function runContinuousScrape(
  options: ContinuousScrapeOptions = {},
): Promise<ContinuousScrapeSummary> {
  const intervalSecs = resolveIntervalSecs(options.intervalSecs);
  const maxCycles = resolveMaxCycles(options.maxCycles);
  const startedAt = Date.now();

  let cycle = 0;
  let completedCycles = 0;
  let failedCycles = 0;
  let totalSaved = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  logger.info('Bắt đầu Continuous TikTok Shop Scraping', {
    actor: env.apify.shopActorId,
    keywords: env.apify.shopKeywords.length,
    maxItemsPerCycle: env.apify.shopMaxItemsPerRun,
    intervalSecs,
    maxCycles: maxCycles === 0 ? 'unlimited' : maxCycles,
    maxCycleAttempts: MAX_CYCLE_ATTEMPTS,
    stopWith: 'Ctrl + C',
  });

  while (!stopRequested && (maxCycles === 0 || cycle < maxCycles)) {
    cycle += 1;

    logger.info(`───── Chu kỳ #${cycle} bắt đầu ─────`);
    const result = await runCycle(cycle);

    if (result.ok) {
      completedCycles += 1;
      totalSaved += result.saved;
      totalUpdated += result.updated;
      totalFailed += result.failed;

      logger.info(
        `Chu kỳ #${cycle} hoàn tất [${result.strategy}] sau ${formatDuration(result.durationMs)}`,
        {
          found: result.found,
          saved: result.saved,
          updated: result.updated,
          failed: result.failed,
        },
      );
    } else {
      failedCycles += 1;
      logger.error(`Chu kỳ #${cycle} thất bại: ${result.errorMessage ?? 'không rõ nguyên nhân'}`);
    }

    if (stopRequested) break;
    if (maxCycles !== 0 && cycle >= maxCycles) break;

    const nextRunAt = new Date(Date.now() + intervalSecs * 1000);
    logger.info(
      `Nghỉ ${formatDuration(intervalSecs * 1000)} — chu kỳ #${cycle + 1} lúc ${nextRunAt.toISOString()}`,
    );

    await interruptibleSleep(intervalSecs * 1000);
  }

  const stoppedBy: ContinuousScrapeSummary['stoppedBy'] = stopRequested
    ? 'signal'
    : maxCycles !== 0
      ? 'maxCycles'
      : 'fatal';

  const summary: ContinuousScrapeSummary = {
    cycles: cycle,
    completedCycles,
    failedCycles,
    totalSaved,
    totalUpdated,
    totalFailed,
    durationMs: Date.now() - startedAt,
    stoppedBy,
  };

  logger.info(
    `Đã dừng Continuous Scraping (${stoppedBy}) sau ${formatDuration(summary.durationMs)}`,
    {
      cycles: summary.cycles,
      completedCycles: summary.completedCycles,
      failedCycles: summary.failedCycles,
      totalSaved: summary.totalSaved,
      totalUpdated: summary.totalUpdated,
      totalFailed: summary.totalFailed,
    },
  );

  return summary;
}
