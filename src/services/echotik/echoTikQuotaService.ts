import prisma from '../../config/db.js';
import { env } from '../../config/env.js';
import { createLogger } from '../../utils/logger.js';
import { EchoTikRequestBudget, getActiveEchoTikRequestBudget, setActiveEchoTikRequestBudget } from './echoTikRequestBudget.js';
import { createHash } from 'node:crypto';

const logger = createLogger('echotik-quota');
const accountKey = createHash('sha256')
  .update(`${env.echotik.baseUrl.trim().toLowerCase()}\0${env.echotik.username.trim().toLowerCase()}`)
  .digest('hex');

export interface QuotaStatus {
  usedThisMonth: number;
  remainingThisMonth: number;
  totalQuota: number;
  monthlyLimit: number;
  percentageUsed: number;
  canSync: boolean;
  nextResetDate: Date;
}

export async function getTrustedEchoTikUsage(): Promise<number> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const quota = await prisma.echoTikAccountQuota.findUnique({
    where: { accountKey_month: { accountKey, month: monthKey } },
    select: { count: true },
  });
  return quota?.count ?? 0;
}

/**
 * Lưu bản ghi sử dụng quota (upsert để tránh duplicate month)
 */
export async function logQuotaUsage(
  requestType: string,
  count: number = 1,
  month?: Date,
): Promise<void> {
  if (count !== 1) throw new Error('EchoTik quota must reserve exactly one HTTP request at a time');
  const baseline = Math.max(0, env.echotik.quotaReconciledUsed);
  const date = month ?? new Date();
  const monthKey = date.toISOString().substring(0, 7); // YYYY-MM

  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "EchoTikAccountQuota" ("accountKey", "month", "count", "requestType", "createdAt", "updatedAt")
    SELECT ${accountKey}, ${monthKey}, ${baseline} + ${count}, ${requestType}, NOW(), NOW()
    WHERE ${baseline} + ${count} <= ${Math.min(50, env.echotik.maxRequestsPerMonth)}
    ON CONFLICT ("accountKey", "month") DO UPDATE
    SET "count" = GREATEST("EchoTikAccountQuota"."count", ${baseline}) + ${count},
        "requestType" = EXCLUDED."requestType",
        "updatedAt" = NOW()
    WHERE GREATEST("EchoTikAccountQuota"."count", ${baseline}) + ${count} <= ${Math.min(50, env.echotik.maxRequestsPerMonth)}
    RETURNING "count"
  `;
  if (rows.length === 0) throw new Error('EchoTik quota exhausted; request was not sent');
  logger.debug(`Logged ${count} quota usage(s) for ${requestType}`);
}

/** Initialize one persisted, aggregate request budget for the entire sync run. */
export async function beginEchoTikRequestBudget(runLimit = 50): Promise<EchoTikRequestBudget> {
  if (getActiveEchoTikRequestBudget()) throw new Error('An EchoTik sync is already running in this process');
  if (env.echotik.quotaReconciledUsed < 0) {
    throw new Error('EchoTik account usage is unverified; reconcile the active account dashboard and set ECHOTIK_QUOTA_RECONCILED_USED before syncing');
  }
  if (env.echotik.quotaReconciledUsed > 50) throw new Error('Reconciled EchoTik usage exceeds the 50-request cap');
  const status = await getQuotaStatus();
  const persistedUsage = status.usedThisMonth;
  const budget = new EchoTikRequestBudget(
    Math.min(50, env.echotik.maxRequestsPerMonth),
    Math.max(persistedUsage, env.echotik.quotaReconciledUsed),
    runLimit,
  );
  if (budget.remaining <= 0) throw new Error('EchoTik request budget exhausted');
  setActiveEchoTikRequestBudget(budget);
  return budget;
}

export function endEchoTikRequestBudget(): void {
  setActiveEchoTikRequestBudget(null);
}

/** Reserve durably before sending. A failed fetch still consumes its request. */
export async function reserveEchoTikRequest(endpoint: string): Promise<void> {
  const budget = getActiveEchoTikRequestBudget();
  if (budget) {
    await budget.reserve(async () => logQuotaUsage(endpoint, 1));
    logger.info(`EchoTik request reserved: ${endpoint}; run=${budget.used}; remaining=${budget.remaining}`);
    return;
  }
  await logQuotaUsage(endpoint, 1);
  logger.info(`EchoTik request reserved: ${endpoint}; run counter unavailable outside orchestrator`);
}

/**
 * Tính toán tình trạng quota hiện tại
 */
export async function getQuotaStatus(): Promise<QuotaStatus> {
  const now = new Date();
  const monthKey = now.toISOString().substring(0, 7);
  const nextReset = getNextMonthReset(now);

  // Tính tổng quota đã sử dụng trong tháng
  const quota = await prisma.echoTikAccountQuota.findUnique({
    where: { accountKey_month: { accountKey, month: monthKey } },
    select: { count: true },
  });
  const usedThisMonth = Math.max(quota?.count ?? 0, env.echotik.quotaReconciledUsed);
  const monthlyLimit = Math.min(50, env.echotik.maxRequestsPerMonth);
  const remainingThisMonth = Math.max(0, monthlyLimit - usedThisMonth);
  const percentageUsed = (usedThisMonth / monthlyLimit) * 100;

  const status: QuotaStatus = {
    usedThisMonth,
    remainingThisMonth,
    totalQuota: monthlyLimit,
    monthlyLimit,
    percentageUsed,
    canSync: remainingThisMonth > 0,
    nextResetDate: nextReset,
  };

  logger.info(
    `Quota status: ${usedThisMonth}/${monthlyLimit} used (${percentageUsed.toFixed(1)}%)`,
  );

  return status;
}

/**
 * Kiểm tra xem có thể đồng bộ dữ liệu từ EchoTik không
 */
export async function canSyncEchoTik(): Promise<boolean> {
  const status = await getQuotaStatus();

  if (!status.canSync) {
    logger.warn(
      `Cannot sync: quota limit reached (${status.usedThisMonth}/${status.totalQuota})`,
    );
    return false;
  }

  return true;
}

/**
 * Lấy ngày reset quota của tháng tiếp theo
 */
function getNextMonthReset(date: Date): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + 1);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

/**
 * Xóa log quota cũ (hơn 3 tháng)
 */
export async function cleanupOldQuotaLogs(): Promise<number> {
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const monthKey = threeMonthsAgo.toISOString().substring(0, 7);

  const result = await prisma.echoTikQuotaLog.deleteMany({
    where: {
      month: { lt: monthKey },
    },
  });

  logger.info(`Cleaned up ${result.count} old quota logs`);
  return result.count;
}
