import type { Request, Response } from 'express';
import { sendSuccess, readStringQuery } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { toOptionalNumber } from '../utils/numbers.js';
import {
  getCategoryOverview,
  getCategoryDetail,
  getSubCategoryDetail,
  getShopVideos,
  resolveHierarchyRange,
} from '../services/hierarchyService.js';
import { listCategoryCatalog, syncCategoryCatalog } from '../services/categoryCatalogService.js';

/**
 * GET /api/categories?range=today|yesterday|7d|30d|90d
 * Trả về cả overview (tổng quan ngành) và danh sách chi tiết.
 */
export async function getCategories(req: Request, res: Response): Promise<void> {
  const resolved = resolveHierarchyRange(req.query);

  const [overview, catalog] = await Promise.all([getCategoryOverview(req.query), listCategoryCatalog()]);

  const catalogByName = new Map(catalog.map((item) => [item.name, item]));

  const analyticsByName = new Map(overview.categories.map((item) => [item.name, item]));
  const allNames = new Set([...catalog.map((item) => item.name), ...analyticsByName.keys()]);
  const categories = [...allNames].map((name) => {
    const category = analyticsByName.get(name);
    return ({
    ...(category ?? { name, productCount: 0, shopCount: 0, totalSales: 0, totalGmv: 0, totalViews: 0, avgPrice: 0, growthRate: 0, shareOfGmv: 0, topSubCategory: null }),
    hasData: category !== undefined,
    slug: catalogByName.get(name)?.slug ?? null,
    catalogId: catalogByName.get(name)?.id ?? null,
    subCategories: catalogByName.get(name)?.subCategories ?? [],
  }); });

  sendSuccess(res, {
    range: overview.range,
    overview: { ...overview.overview, categoryCount: categories.length, analyticsCategoryCount: overview.categories.length },
    categories,
    meta: { days: resolved.days, anchor: resolved.anchor, key: resolved.key },
  });
}

export async function getCategory(req: Request, res: Response): Promise<void> {
  const rawCategory = readStringQuery(req.params.category);
  if (!rawCategory) throw AppError.badRequest('Thiếu tên ngành hàng');

  const name = decodeURIComponent(rawCategory);
  const catalog = await listCategoryCatalog();
  const entry = catalog.find((item) => item.name === name || item.slug === name);
  try {
    sendSuccess(res, { ...await getCategoryDetail(entry?.name ?? name, req.query), hasData: true });
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 404 || !entry) throw error;
    sendSuccess(res, {
      category: entry.name, hasData: false, productCount: 0, shopCount: 0, totalSales: 0,
      totalGmv: 0, totalViews: 0, avgPrice: 0, growthRate: 0, timeline: [], topProducts: [],
      subCategories: entry.subCategories.map((sub) => ({ ...sub, category: entry.name, hasData: false,
        productCount: 0, shopCount: 0, totalSales: 0, totalGmv: 0, totalViews: 0, avgPrice: 0, growthRate: 0, shareOfGmv: 0 })),
    });
  }
}

export async function getSubCategory(req: Request, res: Response): Promise<void> {
  const rawCategory = readStringQuery(req.params.category);
  const rawSub = readStringQuery(req.params.subCategory);
  if (!rawCategory || !rawSub) throw AppError.badRequest('Thiếu tham số ngành hàng hoặc ngành con');

  sendSuccess(
    res,
    await getCatalogSubCategory(decodeURIComponent(rawCategory), decodeURIComponent(rawSub), req.query),
  );
}

async function getCatalogSubCategory(category: string, subCategory: string, query: unknown) {
  try { return { ...await getSubCategoryDetail(category, subCategory, query), hasData: true }; }
  catch (error) {
    if (!(error instanceof AppError) || error.statusCode !== 404) throw error;
    const entry = (await listCategoryCatalog()).find((item) => item.name === category);
    if (!entry?.subCategories.some((sub) => sub.name === subCategory)) throw error;
    return { category, subCategory, hasData: false, productCount: 0, shopCount: 0, totalSales: 0,
      totalGmv: 0, totalViews: 0, avgPrice: 0, growthRate: 0, shops: [], timeline: [], topProducts: [] };
  }
}

export async function getVideosByShop(req: Request, res: Response): Promise<void> {
  const shopId = toOptionalNumber(req.params.id);
  if (shopId === null || !Number.isInteger(shopId) || shopId <= 0) {
    throw AppError.badRequest('ID shop không hợp lệ');
  }

  sendSuccess(res, await getShopVideos(shopId, req.query.limit));
}

/** POST /api/categories/sync – đồng bộ taxonomy tĩnh vào DB */
export async function syncCategories(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await syncCategoryCatalog());
}
