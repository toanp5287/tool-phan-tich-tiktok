import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { clampInt } from '../utils/numbers.js';
import { createProductAnalysis, getAnalysisById, getLatestProductAnalysis, listProductAnalyses } from '../services/ai/aiAnalysisService.js';

function id(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value <= 0) throw AppError.badRequest('ID không hợp lệ');
  return value;
}

export async function createAnalysis(req: Request, res: Response): Promise<void> {
  const productId = id(req.params.id);
  const body = req.body as { force?: boolean; days?: unknown } | undefined;
  sendSuccess(res, await createProductAnalysis(productId, clampInt(body?.days, 7, 90, 30), body?.force === true));
}
export async function latestAnalysis(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await getLatestProductAnalysis(id(req.params.id)));
}
export async function analysisHistory(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await listProductAnalyses(id(req.params.id)));
}
export async function analysisById(req: Request, res: Response): Promise<void> {
  const raw = String(req.params.reportId ?? '');
  if (!/^\d+$/.test(raw)) throw AppError.badRequest('ID báo cáo không hợp lệ');
  const value = BigInt(raw);
  sendSuccess(res, await getAnalysisById(value));
}
