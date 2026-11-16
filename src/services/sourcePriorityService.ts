import { createLogger } from '../utils/logger.js';
import type { ProductSnapshot } from '@prisma/client';

const logger = createLogger('source-priority');

/**
 * Định nghĩa mức ưu tiên nguồn dữ liệu
 * Số nhỏ = ưu tiên cao hơn
 */
const SOURCE_PRIORITY: Record<string, number> = {
  echotik: 1, // EchoTik được ưu tiên cao nhất
  apify: 2, // Apify là backup
};

export function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 999;
}

/**
 * Sắp xếp snapshots theo mức ưu tiên nguồn
 * Snapshot từ nguồn ưu tiên cao hơn sẽ ở đầu
 */
export function sortBySourcePriority<T extends { source: string }>(
  snapshots: T[],
): T[] {
  return [...snapshots].sort(
    (a, b) => getSourcePriority(a.source) - getSourcePriority(b.source),
  );
}

/**
 * Lấy snapshot ưu tiên nhất từ một array
 * Nếu có snapshot từ EchoTik, dùng đó. Nếu không, dùng từ Apify.
 */
export function getPreferredSnapshot<T extends { source: string }>(
  snapshots: T[],
): T | null {
  if (!snapshots || snapshots.length === 0) return null;
  const sorted = sortBySourcePriority(snapshots);
  return sorted[0] ?? null;
}

/**
 * Lấy snapshots ưu tiên từ nhiều ngày (với preference by source)
 * Dùng cho việc tính toán metrics lịch sử
 */
export function getPreferredSnapshotsByDate<T extends { source: string; bucketDate: Date }>(
  snapshots: T[],
): Map<string, T> {
  const map = new Map<string, T>();

  // Sắp xếp theo bucketDate (mới nhất trước) và source priority
  const sorted = [...snapshots].sort((a, b) => {
    const dateCompare = b.bucketDate.getTime() - a.bucketDate.getTime();
    if (dateCompare !== 0) return dateCompare;
    return getSourcePriority(a.source) - getSourcePriority(b.source);
  });

  // Lấy snapshot ưu tiên nhất cho mỗi ngày
  for (const snapshot of sorted) {
    const dateKey = snapshot.bucketDate.toISOString().split('T')[0] ?? '';
    if (dateKey && !map.has(dateKey)) {
      map.set(dateKey, snapshot);
    }
  }

  return map;
}

/**
 * Thêm metadata về source vào response object
 */
export function enrichWithSourceMetadata<T extends { source?: string }>(
  snapshot: { source: string } & T,
): T & { source: string; sourcePriority: number; sourceLabel: string } {
  const priority = getSourcePriority(snapshot.source);
  const sourceLabel = snapshot.source === 'echotik' ? 'EchoTik' : 'Apify';

  return {
    ...snapshot,
    source: snapshot.source,
    sourcePriority: priority,
    sourceLabel,
  };
}

/**
 * Lấy danh sách các source có dữ liệu trong snapshots
 */
export function getAvailableSources<T extends { source: string }>(
  snapshots: T[],
): string[] {
  const sources = new Set<string>(snapshots.map((s) => s.source));
  return Array.from(sources).sort(
    (a, b) => getSourcePriority(a) - getSourcePriority(b),
  );
}

/**
 * Log source preference info (debug)
 */
export function logSourcePreference(
  snapshots: Array<{ source: string }>,
  context: string,
): void {
  if (snapshots.length === 0) {
    logger.debug(`[${context}] No snapshots available`);
    return;
  }

  const preferred = getPreferredSnapshot(snapshots);
  const sources = getAvailableSources(snapshots);

  logger.debug(
    `[${context}] Using source: ${preferred?.source ?? 'none'} (available: ${sources.join(', ')})`,
  );
}
