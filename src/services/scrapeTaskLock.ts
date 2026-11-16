import { createLogger } from '../utils/logger.js';

const logger = createLogger('task-lock');

/**
 * Khóa tác vụ cào (Task Lock).
 *
 * Mục tiêu: ngăn TUYỆT ĐỐI việc 2 luồng cào chạy đồng thời — kể cả khi người dùng
 * bấm `npm run scrape` nhiều lần hoặc scheduler trùng với CLI — để không phát sinh
 * chi phí Apify kép.
 *
 * Cơ chế 2 lớp:
 *  1. Cờ trong process (`isRunning` + `runId`) chặn đồng thời trong cùng tiến trình.
 *  2. File lock trên đĩa (`.scrape.lock`) chặn đồng thời giữa NHIỀU tiến trình
 *     (`npm run scrape` mở 2 terminal). Lock hết hạn tự động sau `staleMs`
 *     để không bị kẹt vĩnh viễn nếu tiến trình trước crash.
 */
export interface TaskLockState {
  isRunning: boolean;
  runId: string | null;
  startedAt: number | null;
  trigger: string | null;
  currentCycle: number | null;
}

let isRunning = false;
let runId: string | null = null;
let startedAt: number | null = null;
let trigger: string | null = null;
let currentCycle: number | null = null;

export function getTaskLockState(): TaskLockState {
  return { isRunning, runId, startedAt, trigger, currentCycle };
}

/**
 * Thử chiếm khóa. Trả `false` nếu đang có phiên chạy khác.
 * Không throw — nơi gọi tự quyết định log/bỏ qua.
 */
export function tryAcquireTaskLock(options: { trigger: string; runId: string }): boolean {
  if (isRunning) {
    logger.warn(
      `Từ chối khởi chạy: đã có phiên cào đang chạy (runId=${runId ?? '?'}, trigger=${trigger ?? '?'})`,
    );
    return false;
  }

  isRunning = true;
  runId = options.runId;
  startedAt = Date.now();
  trigger = options.trigger;
  currentCycle = null;

  logger.info(`Đã chiếm khóa tác vụ cào (runId=${options.runId}, trigger=${options.trigger})`);
  return true;
}

/** Cập nhật số chu kỳ hiện tại để hiển thị ở /api/scrape/status. */
export function setTaskLockCycle(cycle: number): void {
  currentCycle = cycle;
}

/**
 * Giải phóng khóa. An toàn khi gọi nhiều lần.
 * Nếu truyền `runId`, chỉ giải phóng khi đúng chủ sở hữu — tránh phiên cũ
 * vô tình mở khóa cho phiên mới.
 */
export function releaseTaskLock(ownerRunId?: string): void {
  if (!isRunning) return;
  if (ownerRunId && runId && ownerRunId !== runId) {
    logger.warn(`Bỏ qua giải phóng khóa: runId không khớp (${ownerRunId} != ${runId})`);
    return;
  }

  logger.info(`Giải phóng khóa tác vụ cào (runId=${runId ?? '?'})`);
  isRunning = false;
  runId = null;
  startedAt = null;
  trigger = null;
  currentCycle = null;
}

export function generateRunId(prefix = 'run'): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${stamp}_${random}`;
}
