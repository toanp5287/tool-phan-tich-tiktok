import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
import { analysisById, analysisHistory, createAnalysis, latestAnalysis } from '../controllers/aiAnalysisController.js';

const router = Router();
router.post('/products/:id/ai-analysis', asyncHandler(createAnalysis));
router.get('/products/:id/ai-analysis/latest', asyncHandler(latestAnalysis));
router.get('/products/:id/ai-analysis', asyncHandler(analysisHistory));
router.get('/ai-analysis/:reportId', asyncHandler(analysisById));
export default router;
