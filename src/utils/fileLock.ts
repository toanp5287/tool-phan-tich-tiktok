import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('file-lock');

/**
 * File lock đa tiến trình.
 *
 * `npm run scrape` mở nhiều terminal => nhiều process Node độc lập, cờ trong
 * bộ nhớ không đủ. File lock đảm bảo mỗi thời điểm chỉ 1 process được cào.
 *
 * - Tạo file bằng cờ `wx` (fail nếu đã tồn tại) => atomic trên hầu hết FS.
 * - Ghi pid + thời điểm + trigger để debug.
 * - Nếu file tồn tại nhưng đã cũ hơn `staleMs` (mặc định 2 giờ) => coi là
 *   lock rác do crash và tự dọn.
 */
export interface FileLockOptions {
  /** Đường dẫn file lock (mặc định `.scrape.lock` ở thư mục gốc dự án). */
  path?: string;
  /** Tuổi tối đa (ms) trước khi coi là lock rác. Mặc định 2 giờ. */
  staleMs?: number;
  /** Nội dung mô tả thêm (trigger, runId). */
  metadata?: Record<string, unknown>;
}

export interface FileLock {
  path: string;
  acquiredAt: number;
  release: () => void;
}

const DEFAULT_PATH = resolve(process.cwd(), '.scrape.lock');
const DEFAULT_STALE_MS = 2 * 60 * 60 * 1000;

export function acquireFileLock(options: FileLockOptions = {}): FileLock | null {
  const path = options.path ?? DEFAULT_PATH;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;

  if (existsSync(path) && isStale(path, staleMs)) {
    logger.warn(`Phát hiện lock cũ (>${Math.round(staleMs / 60000)} phút) tại ${path}, tự động dọn`);
    safeUnlink(path);
  }

  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    if (isAlreadyExists(error)) {
      logger.warn(`Không thể chiếm file lock: đã có tiến trình khác đang cào (${describeLock(path)})`);
      return null;
    }
    throw error;
  }

  const acquiredAt = Date.now();
  const payload = {
    pid: process.pid,
    acquiredAt: new Date(acquiredAt).toISOString(),
    ...options.metadata,
  };

  try {
    writeSync(fd, JSON.stringify(payload));
  } finally {
    closeSync(fd);
  }

  let released = false;
  return {
    path,
    acquiredAt,
    release: () => {
      if (released) return;
      released = true;
      safeUnlink(path);
      logger.info(`Đã giải phóng file lock ${path}`);
    },
  };
}

function isStale(path: string, staleMs: number): boolean {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { acquiredAt?: string };
    const acquiredAt = parsed.acquiredAt ? Date.parse(parsed.acquiredAt) : Number.NaN;
    if (!Number.isFinite(acquiredAt)) return true;
    return Date.now() - acquiredAt > staleMs;
  } catch {
    // File hỏng/không đọc được => coi là rác.
    return true;
  }
}

function describeLock(path: string): string {
  try {
    return readFileSync(path, 'utf8').slice(0, 300);
  } catch {
    return 'không đọc được nội dung';
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST';
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Bỏ qua: file có thể đã bị xóa bởi tiến trình khác.
  }
}
