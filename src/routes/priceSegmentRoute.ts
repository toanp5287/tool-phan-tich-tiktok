import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import {
  getProductVariants,
  getSegmentDefinitions,
  getSegmentedProducts,
  getSegmentsOverview,
} from '../controllers/priceSegmentController.js';

const priceSegmentRouter = Router();

// Định nghĩa 4 phân khúc giá chuẩn (Dưới 100k, 100k-300k, 300k-500k, Trên 500k)
priceSegmentRouter.get('/definitions', asyncHandler(getSegmentDefinitions));

// Tổng quan phân bổ sản phẩm, GMV, sản lượng theo từng phân khúc giá
priceSegmentRouter.get('/overview', asyncHandler(getSegmentsOverview));

// Lọc sản phẩm theo đa phân khúc giá hoặc khoảng giá minPrice/maxPrice
priceSegmentRouter.get('/products', asyncHandler(getSegmentedProducts));

// Chi tiết biến thể SKU và dải giá của một sản phẩm
priceSegmentRouter.get('/products/:id/variants', asyncHandler(getProductVariants));

export default priceSegmentRouter;
