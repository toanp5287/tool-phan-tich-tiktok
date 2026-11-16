import prisma from '../../config/db.js';
import type { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { analyzeWithGemini } from './geminiService.js';
import { buildProductAnalysisData } from './aiAnalysisDataService.js';

const PROMPT_VERSION = 'v1';

export async function createProductAnalysis(productId: number, days: number, force = false) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!product) throw AppError.notFound(`Không tìm thấy sản phẩm #${productId}`);
  const latest = await prisma.aiAnalysisReport.findFirst({ where: { productId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  if (!force && latest) return serializeReport(latest);

  const dayBucket = new Date().toISOString().slice(0, 10);
  const [daily, productCount] = await Promise.all([
    prisma.aiUsageCounter.upsert({ where: { scope_bucket: { scope: 'GLOBAL_DAILY', bucket: dayBucket } }, create: { scope: 'GLOBAL_DAILY', bucket: dayBucket }, update: {} }),
    prisma.aiAnalysisReport.count({ where: { productId, requestedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);
  if (daily.requestCount >= env.gemini.maxAnalysesPerDay) throw AppError.tooManyRequests('Đã đạt giới hạn phân tích AI trong ngày.');
  if (productCount >= env.gemini.maxAnalysesPerProduct) throw AppError.tooManyRequests('Sản phẩm đã đạt giới hạn phân tích AI trong 24 giờ.');

  const data = await buildProductAnalysisData(productId, days);
  if (!data) throw AppError.notFound(`Không tìm thấy dữ liệu sản phẩm #${productId}`);
  const report = await prisma.aiAnalysisReport.create({ data: { productId, status: 'RUNNING', model: env.gemini.model, promptVersion: PROMPT_VERSION, dataWindowDays: data.dataQuality.requestedWindowDays, dataAsOf: data.dataQuality.latestSnapshotAt ? new Date(data.dataQuality.latestSnapshotAt) : null, dataQuality: data.dataQuality } });
  try {
    const result = await analyzeWithGemini(data);
    const estimatedCost = (result.inputTokens * env.gemini.inputPricePerMillionTokens + result.outputTokens * env.gemini.outputPricePerMillionTokens) / 1_000_000;
    const saved = await prisma.$transaction(async (tx) => {
      const completed = await tx.aiAnalysisReport.update({ where: { id: report.id }, data: { status: 'COMPLETED', report: result.report as Prisma.InputJsonValue, inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: result.totalTokens, estimatedCost, completedAt: new Date() } });
      await tx.aiUsageCounter.update({ where: { id: daily.id }, data: { requestCount: { increment: 1 }, inputTokens: { increment: result.inputTokens }, outputTokens: { increment: result.outputTokens }, totalTokens: { increment: result.totalTokens }, estimatedCost: { increment: estimatedCost } } });
      return completed;
    });
    return serializeReport(saved);
  } catch (error) {
    await prisma.aiAnalysisReport.update({ where: { id: report.id }, data: { status: 'FAILED', errorMessage: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000), completedAt: new Date() } }).catch(() => undefined);
    throw error;
  }
}

export async function getLatestProductAnalysis(productId: number) {
  const report = await prisma.aiAnalysisReport.findFirst({ where: { productId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  return report ? serializeReport(report) : null;
}

export async function listProductAnalyses(productId: number) {
  const reports = await prisma.aiAnalysisReport.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, status: true, model: true, dataWindowDays: true, dataAsOf: true, inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true, errorMessage: true, requestedAt: true, completedAt: true, createdAt: true } });
  return reports.map((report) => ({ ...report, id: report.id.toString(), estimatedCost: report.estimatedCost?.toString() ?? null }));
}

export async function getAnalysisById(id: bigint) {
  const report = await prisma.aiAnalysisReport.findUnique({ where: { id } });
  if (!report) throw AppError.notFound('Không tìm thấy báo cáo AI');
  return serializeReport(report);
}

function serializeReport(report: { id: bigint; productId: number; status: string; model: string; promptVersion: string; report: unknown; dataQuality: unknown; dataWindowDays: number; dataAsOf: Date | null; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: unknown; errorMessage: string | null; requestedAt: Date; completedAt: Date | null; createdAt: Date }) {
  return { ...report, id: report.id.toString(), dataAsOf: report.dataAsOf?.toISOString() ?? null, requestedAt: report.requestedAt.toISOString(), completedAt: report.completedAt?.toISOString() ?? null, createdAt: report.createdAt.toISOString(), estimatedCost: report.estimatedCost?.toString() ?? null };
}
