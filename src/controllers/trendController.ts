import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import {
  getCategoryTrendDetail,
  getCategoryTrendOverview,
  getTrendComparison,
  getTrendPeriods,
} from '../services/trendService.js';

function readCategoryParam(req: Request): string {
  const raw = req.params.category;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) throw AppError.badRequest('Tên ngành hàng không được để trống');
  return value;
}

function readCategoryFilter(raw: Request['query'][string]): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((value) => (typeof value === 'string' ? value.split(',') : []));
  }
  if (typeof raw === 'string') {
    const legacy = raw.trim().startsWith('[') ? safeJsonArray(raw) : null;
    return legacy ?? raw.split(',');
  }
  return [];
}

function safeJsonArray(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

/**
 * GET /api/trend-analysis/overview?days=30&periods=2
 * Danh sách ngành hàng kèm chỉ số kỳ hiện tại vs kỳ trước.
 */
export async function getOverview(req: Request, res: Response): Promise<void> {
  const data = await getCategoryTrendOverview(req.query.days, req.query.periods, req.query.range);
  sendSuccess(res, data);
}

/**
 * GET /api/trend-analysis/category/:category?days=30&periods=2
 * Chi tiết xu hướng một ngành: sub-category, top product, top video, hashtag, sound.
 */
export async function getCategoryDetail(req: Request, res: Response): Promise<void> {
  const category = readCategoryParam(req);
  const data = await getCategoryTrendDetail(category, req.query.days, req.query.periods, req.query.range);
  sendSuccess(res, data);
}

/**
 * GET /api/trend-analysis/comparison?days=30&periods=2&categories=A,B
 * Bảng so sánh đa kỳ giữa các ngành hàng.
 */
export async function getComparison(req: Request, res: Response): Promise<void> {
  const categories = readCategoryFilter(req.query.categories);
  const data = await getTrendComparison(req.query.days, req.query.periods, categories, req.query.range);
  sendSuccess(res, data);
}

/**
 * GET /api/trend-analysis/periods?days=30&periods=2
 * Metadata các kỳ (dùng dựng bộ chọn kỳ trên UI).
 */
export async function getPeriods(req: Request, res: Response): Promise<void> {
  const data = await getTrendPeriods(req.query.days, req.query.periods, req.query.range);
  sendSuccess(res, data);
}
