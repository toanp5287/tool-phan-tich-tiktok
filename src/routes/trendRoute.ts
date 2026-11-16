import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import {
  getCategoryDetail,
  getComparison,
  getOverview,
  getPeriods,
} from '../controllers/trendController.js';

const trendRouter = Router();

// Danh sách ngành hàng + mũi tên chỉ thị (so sánh kỳ hiện tại vs kỳ trước)
trendRouter.get('/overview', asyncHandler(getOverview));

// Metadata các kỳ phân tích (dựng bộ chọn kỳ trên UI)
trendRouter.get('/periods', asyncHandler(getPeriods));

// Bảng so sánh đa kỳ giữa các ngành (lọc qua ?categories=A,B)
trendRouter.get('/comparison', asyncHandler(getComparison));

// Chi tiết xu hướng 1 ngành: sub-category, top product/video, hashtag, sound
trendRouter.get('/category/:category', asyncHandler(getCategoryDetail));

export default trendRouter;
