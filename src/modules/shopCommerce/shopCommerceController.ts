import type { Request, Response } from 'express';
import { sendPaginated, sendSuccess, readPagination, readStringQuery } from '../../utils/http.js';
import { AppError } from '../../utils/errors.js';
import { clampInt, toOptionalNumber } from '../../utils/numbers.js';
import { resolveCommerceRange } from './metrics.js';
import { getCommerceHome } from './homeService.js';
import { getCommerceProductDetail, listCommerceProducts } from './commerceRepository.js';
import { getCommerceShopDetail, listCommerceShops } from './shopService.js';
import { getCommerceCreatorDetail, listCommerceCreators } from './creatorService.js';
import { getCommerceCategoryDetail, listCommerceCategories } from './categoryService.js';

function parseId(raw: unknown, label: string): number {
  const parsed = toOptionalNumber(raw);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.badRequest(`${label} không hợp lệ`);
  }
  return parsed;
}

/** GET /api/commerce/overview?range=today|yesterday|7d|30d|90d */
export async function getOverview(req: Request, res: Response): Promise<void> {
  const range = resolveCommerceRange(req.query);
  sendSuccess(res, await getCommerceHome(range));
}

/** GET /api/commerce/products?range=30d&sortBy=gmv&page=1 */
export async function getProducts(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query, { pageSize: 20 });
  const range = resolveCommerceRange(req.query);
  const sortBy = readStringQuery(req.query.sortBy) as 'gmv' | 'sales' | 'price' | 'recent' | 'sellers' | '';

  const { items, total } = await listCommerceProducts({
    search: readStringQuery(req.query.search) || readStringQuery(req.query.q) || undefined,
    category: readStringQuery(req.query.category) || undefined,
    subCategory: readStringQuery(req.query.subCategory) || undefined,
    shopId: toOptionalNumber(req.query.shopId) ?? undefined,
    sortBy: sortBy || 'gmv',
    sortDir: readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc',
    page: pagination.page,
    pageSize: pagination.pageSize,
    range,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

/** GET /api/commerce/products/:id?range=30d */
export async function getProductById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id, 'ID sản phẩm');
  const range = resolveCommerceRange(req.query);
  sendSuccess(res, await getCommerceProductDetail(id, range));
}

/** GET /api/commerce/shops?range=30d */
export async function getShops(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query, { pageSize: 10 });
  const range = resolveCommerceRange(req.query);
  const sortBy = readStringQuery(req.query.sortBy) as 'gmv' | 'sales' | 'products' | 'recent' | '';

  const { items, total } = await listCommerceShops({
    search: readStringQuery(req.query.search) || undefined,
    sortBy: sortBy || 'gmv',
    sortDir: readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc',
    page: pagination.page,
    pageSize: pagination.pageSize,
    range,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

/** GET /api/commerce/shops/:id?range=30d */
export async function getShopById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id, 'ID shop');
  const range = resolveCommerceRange(req.query);
  sendSuccess(res, await getCommerceShopDetail(id, range));
}

/** GET /api/commerce/creators?range=30d */
export async function getCreators(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query, { pageSize: 10 });
  const range = resolveCommerceRange(req.query);
  const roleRaw = readStringQuery(req.query.role).toUpperCase();
  const role = roleRaw === 'AFFILIATE' || roleRaw === 'CREATOR' ? (roleRaw as 'AFFILIATE' | 'CREATOR') : undefined;
  const sortBy = readStringQuery(req.query.sortBy) as 'gmv' | 'followers' | 'engagement' | 'sales' | '';

  const { items, total } = await listCommerceCreators({
    search: readStringQuery(req.query.search) || undefined,
    role,
    sortBy: sortBy || 'gmv',
    sortDir: readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc',
    page: pagination.page,
    pageSize: pagination.pageSize,
    range,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

/** GET /api/commerce/creators/:id?range=30d */
export async function getCreatorById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id, 'ID nhà sáng tạo');
  const range = resolveCommerceRange(req.query);
  sendSuccess(res, await getCommerceCreatorDetail(id, range));
}

/** GET /api/commerce/categories?range=30d */
export async function getCategories(req: Request, res: Response): Promise<void> {
  const range = resolveCommerceRange(req.query);
  const now = new Date();
  const categories = await listCommerceCategories(now, range);

  const totals = categories.reduce(
    (acc, category) => ({
      gmv: acc.gmv + category.totalGmv,
      sales: acc.sales + category.totalSales,
      products: acc.products + category.productCount,
      shops: acc.shops + category.shopCount,
    }),
    { gmv: 0, sales: 0, products: 0, shops: 0 },
  );

  sendSuccess(res, {
    range,
    overview: {
      categoryCount: categories.length,
      totalGmv: totals.gmv,
      totalSales: totals.sales,
      totalProducts: totals.products,
      totalShops: totals.shops,
      growthRate: categories[0]?.growthRate ?? 0,
    },
    categories,
  });
}

/** GET /api/commerce/categories/:name?range=30d */
export async function getCategoryByName(req: Request, res: Response): Promise<void> {
  const rawName = readStringQuery(req.params.name);
  if (!rawName) throw AppError.badRequest('Thiếu tên ngành hàng');
  const range = resolveCommerceRange(req.query);
  sendSuccess(res, await getCommerceCategoryDetail(decodeURIComponent(rawName), new Date(), range));
}

/** GET /api/commerce/trend-videos?limit=12 */
export async function getTrendVideos(req: Request, res: Response): Promise<void> {
  const limit = clampInt(req.query.limit, 1, 50, 12);
  const { default: prisma } = await import('../../config/db.js');
  const { toTrendVideo } = await import('./commerceRepository.js');

  const rows = await prisma.trendItem.findMany({
    orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
    take: limit,
  });

  sendSuccess(res, rows.map(toTrendVideo));
}
