import type { Request, Response } from 'express';
import { sendPaginated, sendSuccess, readPagination, readStringQuery } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { toOptionalNumber } from '../utils/numbers.js';
import { resolveTimeRange, timeRangeToDays } from '../utils/timeRange.js';
import { getCreatorDetail, getTopCreators, listCreators } from '../services/creatorService.js';
import { isCreativeScrapeRunning, runCreativeScrapePipeline } from '../services/creativeScrapeService.js';
import { env } from '../config/env.js';
import { JOB_TRIGGER } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('creator-controller');

function parseId(raw: unknown): number {
  const parsed = toOptionalNumber(raw);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.badRequest('ID nhà sáng tạo không hợp lệ');
  }
  return parsed;
}

/**
 * GET /api/creators?range=30d&sortBy=gmv&page=1
 */
export async function getCreators(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query, { pageSize: 12 });
  const range = resolveTimeRange(req.query);
  const roleRaw = readStringQuery(req.query.role).toUpperCase();
  const role = roleRaw === 'AFFILIATE' || roleRaw === 'CREATOR' ? (roleRaw as 'AFFILIATE' | 'CREATOR') : undefined;
  const sortByRaw = readStringQuery(req.query.sortBy) as 'gmv' | 'followers' | 'engagement' | 'sales' | '';

  const { items, total } = await listCreators({
    search: readStringQuery(req.query.search) || readStringQuery(req.query.q) || undefined,
    region: readStringQuery(req.query.region) || undefined,
    role,
    sortBy: sortByRaw || 'gmv',
    sortDir: readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc',
    page: pagination.page,
    pageSize: pagination.pageSize,
    days: range.days,
    anchor: range.anchor,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

export async function getTopCreatorsList(req: Request, res: Response): Promise<void> {
  const limit = toOptionalNumber(req.query.limit) ?? 10;
  const range = resolveTimeRange(req.query);

  sendSuccess(res, await getTopCreators(limit, range.days, range.anchor));
}

export async function getCreatorById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  const range = resolveTimeRange(req.query);

  sendSuccess(res, await getCreatorDetail(id, range.days, range.anchor));
}

/** POST /api/creators/scrape — kích hoạt cào Creative Center thủ công */
export async function triggerCreativeScrape(req: Request, res: Response): Promise<void> {
  if (env.scrape.shopOnly) {
    throw new AppError('Chế độ hiện tại chỉ cho phép TikTok Shop và creator discovery giới hạn.', 403, 'SHOP_ONLY_MODE');
  }

  if (env.adminToken) {
    const provided = req.header('x-admin-token') ?? '';
    if (provided !== env.adminToken) throw AppError.unauthorized('Token quản trị không hợp lệ');
  }

  if (isCreativeScrapeRunning() && req.query.force !== 'true') {
    throw AppError.conflict('Phiên cào Creative Center đang chạy. Dùng ?force=true để bỏ qua guard.');
  }

  if (!env.apify.token) {
    throw AppError.badRequest('Chưa cấu hình APIFY_TOKEN nên không thể cào Creative Center.');
  }

  const periodRaw = readStringQuery(req.query.period);
  const period = (['7', '30', '90', '120'].includes(periodRaw) ? periodRaw : '30') as '7' | '30' | '90' | '120';

  void runCreativeScrapePipeline({ trigger: JOB_TRIGGER.API, period, force: req.query.force === 'true' })
    .then((result) => logger.info('Creative scrape thủ công hoàn tất', result))
    .catch((error) => logger.error('Creative scrape thủ công thất bại', error));

  res.status(202).json({
    success: true,
    data: {
      message: 'Đã khởi chạy phiên cào Creative Center (creators/affiliates).',
      hint: 'Theo dõi qua GET /api/jobs?limit=5',
      period,
    },
  });
}
