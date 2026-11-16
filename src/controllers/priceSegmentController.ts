import type { Request, Response } from 'express';
import {
  readPagination,
  readStringQuery,
  sendPaginated,
  sendSuccess,
} from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { toOptionalNumber } from '../utils/numbers.js';
import {
  getPriceSegmentOverview,
  getProductVariantsDetail,
  listProductsByPriceSegment,
  parseSegmentCodes,
  PRICE_SEGMENTS,
} from '../services/priceSegmentService.js';
import type { PriceSegmentFilterInput } from '../types/priceSegment.js';

const VALID_SORTS = new Set<NonNullable<PriceSegmentFilterInput['sortBy']>>([
  'gmv',
  'sales',
  'views',
  'price',
  'minPrice',
  'maxPrice',
  'variants',
  'recent',
]);

function parsePositiveId(raw: unknown, label: string): number {
  const parsed = toOptionalNumber(raw);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw AppError.badRequest(`${label} không hợp lệ`);
  }
  return parsed;
}

/**
 * GET /api/price-segments/definitions
 * Trả về cấu hình 4 phân khúc giá chuẩn cho UI.
 */
export async function getSegmentDefinitions(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, PRICE_SEGMENTS);
}

/**
 * GET /api/price-segments/overview?category=&subCategory=
 * Tổng quan phân bổ sản phẩm, GMV, sản lượng theo từng phân khúc giá.
 */
export async function getSegmentsOverview(req: Request, res: Response): Promise<void> {
  const category = readStringQuery(req.query.category) || undefined;
  const subCategory = readStringQuery(req.query.subCategory) || undefined;
  const overview = await getPriceSegmentOverview({ category, subCategory });
  sendSuccess(res, overview);
}

/**
 * GET /api/price-segments/products
 * Query: segments (under-100k,100k-300k,300k-500k,over-500k), minPrice, maxPrice,
 *        category, subCategory, search, shopId, onlyMultiVariant, sortBy, sortDir, page, pageSize
 */
export async function getSegmentedProducts(req: Request, res: Response): Promise<void> {
  const pagination = readPagination(req.query);
  const segments = parseSegmentCodes(req.query.segments ?? req.query.segment);
  const minPrice = toOptionalNumber(req.query.minPrice);
  const maxPrice = toOptionalNumber(req.query.maxPrice);

  if (
    minPrice !== null &&
    maxPrice !== null &&
    minPrice > 0 &&
    maxPrice > 0 &&
    minPrice > maxPrice
  ) {
    throw AppError.badRequest('Giá tối thiểu (minPrice) không được lớn hơn giá tối đa (maxPrice)');
  }

  const sortRaw = readStringQuery(req.query.sortBy) as NonNullable<PriceSegmentFilterInput['sortBy']>;
  const sortBy = VALID_SORTS.has(sortRaw) ? sortRaw : 'gmv';
  const sortDir = readStringQuery(req.query.sortDir) === 'asc' ? 'asc' : 'desc';

  const shopIdRaw = toOptionalNumber(req.query.shopId);
  const shopId = shopIdRaw !== null && Number.isInteger(shopIdRaw) && shopIdRaw > 0 ? shopIdRaw : undefined;
  const onlyMultiVariant = req.query.onlyMultiVariant === 'true' || req.query.onlyMultiVariant === '1';

  const { items, total } = await listProductsByPriceSegment({
    segments,
    minPrice,
    maxPrice,
    category: readStringQuery(req.query.category) || undefined,
    subCategory: readStringQuery(req.query.subCategory) || undefined,
    search: readStringQuery(req.query.search) || readStringQuery(req.query.q) || undefined,
    shopId,
    onlyMultiVariant,
    sortBy,
    sortDir,
    page: pagination.page,
    pageSize: pagination.pageSize,
  });

  sendPaginated(res, items, {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
  });
}

/**
 * GET /api/price-segments/products/:id/variants
 * Chi tiết biến thể SKU và dải giá của một sản phẩm.
 */
export async function getProductVariants(req: Request, res: Response): Promise<void> {
  const productId = parsePositiveId(req.params.id, 'ID sản phẩm');
  const detail = await getProductVariantsDetail(productId);
  sendSuccess(res, detail);
}
