import type { Request, Response } from 'express';
import { sendPaginated, sendSuccess, readPagination, readStringQuery, readIdParam } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { JOB_TRIGGER } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';
import type { ShopPriority } from '@prisma/client';
import type { CreateTargetedShopBody, UpdateTargetedShopBody } from '../types/targetedShop.js';
import {
  createTargetedShop,
  deleteTargetedShop,
  getTargetedShopById,
  listTargetedShops,
  toggleTargetedShopStatus,
  updateTargetedShop,
} from '../services/targetedShopService.js';
import { isProfileScrapeRunning, runProfileScrapePipeline } from '../services/profileScrapeService.js';

const logger = createLogger('targeted-shop-controller');

// ─── Auth guard (tái dụng pattern từ scrapeController) ───────────────────────
function assertAdmin(req: Request): void {
  if (!env.adminToken) return;
  const provided = req.header('x-admin-token') ?? '';
  if (provided !== env.adminToken) {
    throw AppError.unauthorized('Token quản trị không hợp lệ');
  }
}

// ─── Validate ShopPriority ────────────────────────────────────────────────────
const VALID_PRIORITIES = new Set<string>(['TOP10', 'TOP50', 'TOP100']);

function parsePriority(raw: unknown): ShopPriority | undefined {
  if (typeof raw !== 'string') return undefined;
  const upper = raw.toUpperCase();
  return VALID_PRIORITIES.has(upper) ? (upper as ShopPriority) : undefined;
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/targets
 * Query: category, priority, isActive, page, pageSize
 */
export async function getTargetedShops(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query, { pageSize: 50 });
  const category = readStringQuery(req.query.category) || undefined;
  const priority = parsePriority(req.query.priority);
  const isActiveRaw = req.query.isActive;
  const isActive =
    isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;

  const { items, total } = await listTargetedShops({
    category,
    priority,
    isActive,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

// ─── GET BY ID ────────────────────────────────────────────────────────────────

/**
 * GET /api/targets/:id
 */
export async function getTargetedShop(req: Request, res: Response): Promise<void> {
  const id = readIdParam(req);
  const item = await getTargetedShopById(id);
  sendSuccess(res, item);
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

/**
 * POST /api/targets
 * Body: { username, platformShopId?, displayName?, category?, note?, priority?, isActive?, scrapeConfig? }
 */
export async function createTarget(req: Request, res: Response): Promise<void> {
  assertAdmin(req);

  const body = req.body as Partial<CreateTargetedShopBody>;

  if (!body.username || typeof body.username !== 'string') {
    throw AppError.badRequest('Trường "username" là bắt buộc và phải là chuỗi');
  }

  const item = await createTargetedShop({
    username: body.username,
    platformShopId: typeof body.platformShopId === 'string' ? body.platformShopId : undefined,
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    category: typeof body.category === 'string' ? body.category : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    priority: parsePriority(body.priority),
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    scrapeConfig: body.scrapeConfig,
  });

  sendSuccess(res, item, 201);
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

/**
 * PATCH /api/targets/:id
 * Body: UpdateTargetedShopBody (tất cả fields đều optional)
 */
export async function updateTarget(req: Request, res: Response): Promise<void> {
  assertAdmin(req);
  const id = readIdParam(req);

  const body = req.body as Partial<UpdateTargetedShopBody>;

  const item = await updateTargetedShop(id, {
    displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
    category: typeof body.category === 'string' ? body.category : undefined,
    note: typeof body.note === 'string' ? body.note : undefined,
    priority: parsePriority(body.priority),
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    scrapeConfig: body.scrapeConfig !== undefined ? body.scrapeConfig : undefined,
  });

  sendSuccess(res, item);
}

// ─── TOGGLE ───────────────────────────────────────────────────────────────────

/**
 * PATCH /api/targets/:id/toggle
 * Body: { isActive: boolean }
 */
export async function toggleTarget(req: Request, res: Response): Promise<void> {
  assertAdmin(req);
  const id = readIdParam(req);

  const { isActive } = req.body as { isActive?: unknown };
  if (typeof isActive !== 'boolean') {
    throw AppError.badRequest('Trường "isActive" phải là boolean');
  }

  const item = await toggleTargetedShopStatus(id, isActive);
  sendSuccess(res, item);
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

/**
 * DELETE /api/targets/:id
 */
export async function deleteTarget(req: Request, res: Response): Promise<void> {
  assertAdmin(req);
  const id = readIdParam(req);
  await deleteTargetedShop(id);
  res.status(204).send();
}

// ─── TRIGGER PROFILE SCRAPE ───────────────────────────────────────────────────

/**
 * POST /api/scrape/run-top-shops
 *
 * Kích hoạt thủ công pipeline cào theo Targeted Profiles.
 * Query params:
 *   - category: lọc shop theo ngành hàng
 *   - priority: TOP10 | TOP50 | TOP100
 *   - force: bỏ qua guard "đang chạy"
 *
 * Trả về 202 Accepted ngay lập tức (pipeline chạy background).
 * Theo dõi qua GET /api/jobs hoặc GET /api/scrape/status.
 */
export async function triggerTopShopScrape(req: Request, res: Response): Promise<void> {
  assertAdmin(req);

  if (env.scrape.shopOnly) {
    throw new AppError('Chế độ hiện tại đã tắt cào profile mạng xã hội.', 403, 'SHOP_ONLY_MODE');
  }

  const force = req.query.force === 'true';

  if (isProfileScrapeRunning() && !force) {
    throw AppError.conflict(
      'Phiên cào Top Shop đang chạy. Dùng ?force=true để bỏ qua guard.',
    );
  }

  const category = readStringQuery(req.query.category) || undefined;
  const priority = parsePriority(req.query.priority);

  logger.info('Kích hoạt thủ công Profile Scrape', { category, priority, force });

  // Chạy nền — không await để trả về 202 ngay
  void runProfileScrapePipeline({
    trigger: JOB_TRIGGER.API,
    category,
    priority,
    force,
  })
    .then((result) =>
      logger.info(`Profile Scrape thủ công hoàn tất`, {
        jobId: result.jobId,
        saved: result.saved,
        updated: result.updated,
        durationMs: result.durationMs,
      }),
    )
    .catch((error) => logger.error('Profile Scrape thủ công thất bại', error));

  res.status(202).json({
    success: true,
    data: {
      message: 'Đã khởi chạy phiên cào Top Shop theo Targeted Profiles.',
      hint: 'Theo dõi tiến trình qua GET /api/jobs hoặc GET /api/scrape/status',
      filters: { category: category ?? null, priority: priority ?? null },
    },
  });
}

/**
 * GET /api/scrape/profile-status
 * Trả về trạng thái hiện tại của profile scrape pipeline.
 */
export async function getProfileScrapeStatus(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, {
    running: isProfileScrapeRunning(),
    config: {
      apifyConfigured: Boolean(env.apify.token),
      actorId: env.apify.actorId,
      maxProfilesPerRun: env.apify.maxProfilesPerRun,
      profileResultsPerPage: env.apify.profileResultsPerPage,
    },
  });
}
