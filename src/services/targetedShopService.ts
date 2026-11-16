import { Prisma, type ShopPriority, type TargetedShop } from '@prisma/client';
import prisma from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { toIso } from '../utils/serializers.js';
import { createLogger } from '../utils/logger.js';
import type {
  CreateTargetedShopBody,
  ShopScrapeConfig,
  TargetedShopFilters,
  TargetedShopItem,
  UpdateTargetedShopBody,
} from '../types/targetedShop.js';

const logger = createLogger('targeted-shop');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Chuẩn hoá username: bỏ @ đầu, lowercase, trim.
 * "@ShopA " → "shopa"
 */
function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

function toItem(row: TargetedShop): TargetedShopItem {
  return {
    id: row.id,
    username: row.username,
    platformShopId: row.platformShopId,
    displayName: row.displayName,
    category: row.category,
    note: row.note,
    priority: row.priority,
    isActive: row.isActive,
    lastScrapedAt: toIso(row.lastScrapedAt),
    scrapeCount: row.scrapeCount,
    failCount: row.failCount,
    scrapeConfig: row.scrapeConfig ? (row.scrapeConfig as unknown as ShopScrapeConfig) : null,
    createdAt: toIso(row.createdAt) ?? '',
    updatedAt: toIso(row.updatedAt) ?? '',
  };
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function listTargetedShops(
  filters: TargetedShopFilters,
): Promise<{ items: TargetedShopItem[]; total: number }> {
  const where: Prisma.TargetedShopWhereInput = {};

  if (filters.category) where.category = { equals: filters.category, mode: 'insensitive' };
  if (filters.priority) where.priority = filters.priority;
  if (filters.isActive !== undefined) where.isActive = filters.isActive;

  const [total, rows] = await Promise.all([
    prisma.targetedShop.count({ where }),
    prisma.targetedShop.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { scrapeCount: 'desc' }, { username: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  return { items: rows.map(toItem), total };
}

export async function getTargetedShopById(id: number): Promise<TargetedShopItem> {
  const row = await prisma.targetedShop.findUnique({ where: { id } });
  if (!row) throw AppError.notFound(`Không tìm thấy Targeted Shop #${id}`);
  return toItem(row);
}

// ─── WRITE ────────────────────────────────────────────────────────────────────

export async function createTargetedShop(body: CreateTargetedShopBody): Promise<TargetedShopItem> {
  const username = normalizeUsername(body.username);

  if (!username) {
    throw AppError.badRequest('username không được rỗng');
  }

  // Kiểm tra trùng username (case-insensitive đã được normalize)
  const existing = await prisma.targetedShop.findUnique({ where: { username } });
  if (existing) {
    throw AppError.conflict(`Username "${username}" đã tồn tại trong danh sách Targeted Shops`);
  }

  const row = await prisma.targetedShop.create({
    data: {
      username,
      platformShopId: body.platformShopId ?? null,
      displayName: body.displayName ?? null,
      category: body.category ?? null,
      note: body.note ?? null,
      priority: body.priority ?? 'TOP100',
      isActive: body.isActive ?? true,
      scrapeConfig: body.scrapeConfig ? (body.scrapeConfig as Prisma.InputJsonValue) : undefined,
    },
  });

  logger.info(`Đã thêm Targeted Shop: @${username} (priority=${row.priority})`);
  return toItem(row);
}

export async function updateTargetedShop(
  id: number,
  body: UpdateTargetedShopBody,
): Promise<TargetedShopItem> {
  // Kiểm tra tồn tại
  const existing = await prisma.targetedShop.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw AppError.notFound(`Không tìm thấy Targeted Shop #${id}`);

  const updateData: Prisma.TargetedShopUpdateInput = {};

  if (body.displayName !== undefined) updateData.displayName = body.displayName;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.note !== undefined) updateData.note = body.note;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  if (body.scrapeConfig !== undefined) {
    // null = xóa config về default
    updateData.scrapeConfig = body.scrapeConfig
      ? (body.scrapeConfig as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  const row = await prisma.targetedShop.update({ where: { id }, data: updateData });
  logger.info(`Đã cập nhật Targeted Shop #${id}`);
  return toItem(row);
}

export async function deleteTargetedShop(id: number): Promise<void> {
  const existing = await prisma.targetedShop.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw AppError.notFound(`Không tìm thấy Targeted Shop #${id}`);

  await prisma.targetedShop.delete({ where: { id } });
  logger.info(`Đã xóa Targeted Shop #${id}`);
}

// ─── Batch toggle isActive ────────────────────────────────────────────────────

export async function toggleTargetedShopStatus(
  id: number,
  isActive: boolean,
): Promise<TargetedShopItem> {
  const row = await prisma.targetedShop.update({
    where: { id },
    data: { isActive },
  });
  return toItem(row);
}

// ─── Query dùng bởi Pipeline ──────────────────────────────────────────────────

/**
 * Lấy danh sách username active để gửi vào Apify.
 * Hỗ trợ lọc theo category, priority và giới hạn theo `limit`.
 */
export async function getActiveProfileUsernames(options: {
  category?: string;
  priority?: ShopPriority;
  limit?: number;
}): Promise<{ username: string; scrapeConfig: ShopScrapeConfig | null }[]> {
  const where: Prisma.TargetedShopWhereInput = { isActive: true };

  if (options.category) where.category = { equals: options.category, mode: 'insensitive' };
  if (options.priority) where.priority = options.priority;

  const rows = await prisma.targetedShop.findMany({
    where,
    select: { username: true, scrapeConfig: true },
    // TOP10 trước, trong mỗi nhóm priority ưu tiên shop ít được cào gần đây nhất
    orderBy: [{ priority: 'asc' }, { lastScrapedAt: 'asc' }, { username: 'asc' }],
    take: options.limit ?? 200,
  });

  return rows.map((row) => ({
    username: row.username,
    scrapeConfig: row.scrapeConfig ? (row.scrapeConfig as unknown as ShopScrapeConfig) : null,
  }));
}

/**
 * Cập nhật `lastScrapedAt` + tăng `scrapeCount` sau khi cào thành công.
 * Dùng `updateMany` để tránh N+1 queries.
 */
export async function markShopsScraped(usernames: string[]): Promise<void> {
  if (usernames.length === 0) return;

  await prisma.targetedShop.updateMany({
    where: { username: { in: usernames } },
    data: {
      lastScrapedAt: new Date(),
      scrapeCount: { increment: 1 },
      failCount: 0, // reset fail streak khi thành công
    },
  });
}

/**
 * Tăng `failCount` khi phiên cào thất bại.
 * Nếu failCount >= threshold → tự động tắt (isActive = false) để khỏi spam Apify.
 */
export async function markShopsFailed(
  usernames: string[],
  autoDisableThreshold = 5,
): Promise<void> {
  if (usernames.length === 0) return;

  // Tăng failCount trước
  await prisma.targetedShop.updateMany({
    where: { username: { in: usernames } },
    data: { failCount: { increment: 1 } },
  });

  // Auto-disable shop lỗi liên tiếp vượt threshold
  const disabled = await prisma.targetedShop.updateMany({
    where: {
      username: { in: usernames },
      failCount: { gte: autoDisableThreshold },
      isActive: true,
    },
    data: { isActive: false },
  });

  if (disabled.count > 0) {
    logger.warn(
      `Tự động tắt ${disabled.count} shop do thất bại liên tiếp >= ${autoDisableThreshold} lần`,
    );
  }
}
