import type { Request, Response } from 'express';
import { env, isEchoTikEnabled } from '../config/env.js';
import { canRunEchoTikSync } from '../services/echotik/echoTikSyncService.js';
import { runEchoTikGroupSync, ECHOTIK_GROUP_ENDPOINTS } from '../services/echotik/echoTikGroupSync.js';
import type { EchoTikGroup } from '../services/echotik/echoTikSyncContext.js';
import { getQuotaStatus } from '../services/echotik/echoTikQuotaService.js';
import { createLogger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

const logger = createLogger('echotik-controller');

/**
 * GET /api/admin/echotik/quota
 * Lấy thông tin quota hiện tại
 */
export async function getEchoTikQuota(req: Request, res: Response): Promise<void> {
  if (!isEchoTikEnabled()) {
    throw new AppError('EchoTik is not enabled', 503, 'ECHOTIK_NOT_CONFIGURED');
  }

  const quotaStatus = await getQuotaStatus();

  res.json({
    success: true,
    data: quotaStatus,
  });
}

/**
 * POST /api/admin/echotik/sync
 * Kích hoạt đồng bộ dữ liệu từ EchoTik
 */
export async function triggerEchoTikSync(req: Request, res: Response): Promise<void> {
  if (!isEchoTikEnabled()) {
    throw new AppError('EchoTik is not enabled', 503, 'ECHOTIK_NOT_CONFIGURED');
  }

  const { canRun, reason } = await canRunEchoTikSync();
  if (!canRun) {
    throw new AppError(`Cannot run sync: ${reason}`, 429, 'ECHOTIK_QUOTA_EXCEEDED');
  }

  logger.info('Triggered EchoTik sync from API');

  const group = req.body?.group;
  if (typeof group !== 'string' || !Object.hasOwn(ECHOTIK_GROUP_ENDPOINTS, group)) {
    throw AppError.badRequest('Specify exactly one group: shops, products, trends, categories');
  }
  const result = await runEchoTikGroupSync(group as EchoTikGroup);

  res.json({
    success: result.status === 'SUCCESS' || result.status === 'NO_CHANGES' || result.status === 'LIMIT_REACHED',
    data: result,
  });
}

/**
 * GET /api/admin/echotik/status
 * Lấy trạng thái có thể chạy sync hay không
 */
export async function getEchoTikSyncStatus(req: Request, res: Response): Promise<void> {
  if (!isEchoTikEnabled()) {
    throw new AppError('EchoTik is not enabled', 503, 'ECHOTIK_NOT_CONFIGURED');
  }

  const { canRun, reason } = await canRunEchoTikSync();
  const quotaStatus = await getQuotaStatus();

  res.json({
    success: true,
    data: {
      enabled: true,
      canRun,
      reason: reason ?? 'Ready to sync',
      quota: quotaStatus,
    },
  });
}
