import type { Request, Response } from 'express';
import { sendPaginated, sendSuccess, readPagination, readStringQuery } from '../utils/http.js';
import { getProductDetail, listProducts, compareProducts } from '../services/productService.js';
import { getDashboardOverview, getTrendSummary, listScrapeJobs } from '../services/dashboardService.js';
import { getKeywordInsights, getShopDetail, listShops, listTrendItems } from '../services/shopService.js';
import { AppError } from '../utils/errors.js';
import { clampInt, toOptionalNumber } from '../utils/numbers.js';
import { resolveTimeRange } from '../utils/timeRange.js';

function parseId(raw: unknown, label: string): number {
  const parsed = toOptionalNumber(raw);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.badRequest(`${label} không hợp lệ`);
  }
  return parsed;
}

export async function getProducts(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query);
  const range = resolveTimeRange(req.query);
  const sortBy = readStringQuery(req.query.sortBy) as
    | 'gmv'
    | 'sales'
    | 'views'
    | 'price'
    | 'recent'
    | 'sellers'
    | '';
  const sortDir = readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc';

  const { items, total } = await listProducts({
    search: readStringQuery(req.query.search) || readStringQuery(req.query.q) || undefined,
    region: readStringQuery(req.query.region) || undefined,
    category: readStringQuery(req.query.category) || undefined,
    subCategory: readStringQuery(req.query.subCategory) || undefined,
    shopId: toOptionalNumber(req.query.shopId) ?? undefined,
    sortBy: sortBy || undefined,
    sortDir,
    page: pagination.page,
    pageSize: pagination.pageSize,
    days: range.days,
    anchor: range.anchor,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

export async function getProductById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id, 'ID sản phẩm');
  const range = resolveTimeRange(req.query);

  const detail = await getProductDetail(id, range.days, range.anchor);
  sendSuccess(res, detail);
}

export async function getProductComparison(req: Request, res: Response): Promise<void> {
  const raw = readStringQuery(req.query.ids);
  const ids = raw
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (ids.length === 0) throw AppError.badRequest('Cần truyền danh sách ID sản phẩm qua ?ids=1,2,3');

  sendSuccess(res, await compareProducts(ids));
}

export async function getShops(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query);
  const sortBy = readStringQuery(req.query.sortBy) as 'gmv' | 'sales' | 'products' | 'recent' | '';
  const range = resolveTimeRange(req.query);

  const { items, total } = await listShops({
    source: readStringQuery(req.query.source) || undefined,
    search: readStringQuery(req.query.search) || readStringQuery(req.query.q) || undefined,
    region: readStringQuery(req.query.region) || undefined,
    sortBy: sortBy || 'gmv',
    sortDir: readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc',
    page: pagination.page,
    pageSize: pagination.pageSize,
    days: range.days,
    anchor: range.anchor,
  });

  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

export async function getShopById(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id, 'ID shop');
  const range = resolveTimeRange(req.query);

  sendSuccess(res, await getShopDetail(id, range.days, range.anchor));
}

export async function getOverview(req: Request, res: Response): Promise<void> {
  const range = resolveTimeRange(req.query);
  sendSuccess(res, await getDashboardOverview(range.days, range.anchor));
}

export async function getTrends(req: Request, res: Response): Promise<void> {
  const range = resolveTimeRange(req.query);
  sendSuccess(res, await getTrendSummary(range.days, range.anchor));
}

export async function getKeywords(req: Request, res: Response): Promise<void> {
  const range = resolveTimeRange(req.query, 7);
  const limit = clampInt(req.query.limit, 1, 50, 15);

  sendSuccess(res, await getKeywordInsights(range.days, limit));
}

export async function getTrendItems(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query);
  const { items, total } = await listTrendItems(pagination.page, pagination.pageSize);
  sendPaginated(res, items, { page: pagination.page, pageSize: pagination.pageSize, total });
}

export async function getJobs(req: Request, res: Response): Promise<void> {
  const limit = clampInt(req.query.limit, 1, 100, 20);
  const status = readStringQuery(req.query.status) || undefined;
  sendSuccess(res, await listScrapeJobs(limit, status));
}
