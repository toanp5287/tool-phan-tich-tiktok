import { createHash } from 'node:crypto';
import { datasetDb as db } from '../../config/datasetDb.js';
import type { Prisma } from '../../../generated/v2/index.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import {
  affiliateContribution,
  buildGrowthSummary,
  buildTimeline,
  competition,
  coverage,
  parseMode,
  readSeries,
  type AnalysisMode,
} from '../analyticsService.js';
import { generateTextWithGemini } from './geminiService.js';
import { providerConfigurationError, providerModel } from './aiProvider.js';

const PROMPT_VERSION = 'product-deep-analysis-v1';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const SYSTEM_PROMPT = `Bạn là nhà phân tích sản phẩm TikTok Shop chuyên sâu cho người bán Việt Nam. Viết báo cáo tiếng Việt bằng Markdown thuần, dựa DUY NHẤT trên số liệu được cung cấp trong context. Không bịa số, không tự tính lại số, không khẳng định quan hệ nhân quân hay doanh số theo kỳ ngoài số liệu đã cho.

Cấu trúc bắt buộc (mỗi phần chỉ viết khi có đủ căn cứ; nếu thiếu dữ liệu, ghi rõ "chưa đủ dữ liệu" và không suy diễn):
## 1. Tổng quan sản phẩm
## 2. Nhu cầu thị trường
## 3. Cạnh tranh
## 4. Phân tích giá
## 5. Creator/Affiliate
## 6. Phân tích lịch sử
## 7. Rủi ro
## 8. Khuyến nghị kinh doanh

Nguyên tắc:
- Phân biệt rõ FACT (số liệu cho sẵn) với INFERENCE (suy luận của bạn) và UNKNOWN (chưa biết).
- Chế độ SIMULATION: mọi số liệu là mô phỏng, KHÔNG phải dữ liệu thị trường thực. Mở đầu báo cáo bằng dòng cảnh báo: "⚠️ BÁO CÁO MÔ PHỎNG — không dùng cho quyết định kinh doanh thực.".
- Chế độ REAL_DATA: chỉ dùng dữ liệu đã xác minh; ghi rõ giới hạn dữ liệu còn thiếu.
- Không dùng HTML hay code fence; trả Markdown thuần.`;

/** Build a bounded, structured numeric context from the shared Analytics Service. */
async function buildContext(productId: number, days: number, mode: AnalysisMode) {
  const [sales, gmv, price] = await Promise.all([
    readSeries('PRODUCT', productId, 'soldCount', mode),
    readSeries('PRODUCT', productId, 'gmv', mode),
    readSeries('PRODUCT', productId, 'price', mode),
  ]);
  const timeline = buildTimeline(sales, gmv, price);
  const growth = buildGrowthSummary(sales, gmv, days);
  const cov = coverage(sales, 90);
  const comp = await competition(productId, mode);
  const affiliate = await affiliateContribution(productId, mode);

  // Product metadata (title/category) is neutral — read regardless of mode.
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true, title: true, currency: true, market: true,
      categories: { where: { isPrimary: true }, take: 1, include: { category: true, subCategory: true } },
    },
  });
  if (!product) throw AppError.notFound(`Không tìm thấy sản phẩm #${productId}`);

  const first = sales.find((p) => p.value !== null);
  const last = [...sales].reverse().find((p) => p.value !== null);

  return {
    mode,
    product: {
      id: product.id,
      title: product.title,
      currency: product.currency,
      market: product.market,
      category: product.categories[0]?.category.name ?? null,
      subCategory: product.categories[0]?.subCategory?.name ?? null,
    },
    currentSales: last?.value ?? null,
    firstObservedSales: first?.value ?? null,
    currentPrice: price.find((p) => p.value !== null) ? [...price].reverse().find((p) => p.value !== null)!.value : null,
    growth: growth.periods.map((period) => ({
      days: period.days,
      salesGrowthRate: period.salesGrowthRate,
      gmvGrowthRate: period.gmvGrowthRate,
      salesDiff: period.salesDiff,
      gmvDelta: period.gmvDelta,
      hasData: period.hasData,
    })),
    timeline: timeline.points.slice(-days).map((p) => ({ date: p.date, sales: p.sales, gmv: p.gmv, price: p.price })),
    coverage: {
      points: cov.points,
      start: cov.start,
      end: cov.end,
      completeness: cov.completeness,
      gaps: cov.gaps.slice(0, 20),
    },
    competition: {
      sellerCount: comp.sellerCount,
      topShopShare: comp.topShopShare,
      concentration: comp.concentration,
      notes: comp.notes,
    },
    affiliate: {
      creatorCount: affiliate.creatorCount,
      sold: affiliate.sold,
      gmv: affiliate.gmv,
      share: affiliate.share,
      limitation: affiliate.limitation,
    },
    limitations: [
      mode === 'SIMULATION' ? 'Dữ liệu mô phỏng (SIMULATED), không phải thị trường thực.' : 'Chỉ dùng dữ liệu VERIFIED/ESTIMATED thực tế.',
      comp.notes[0] ?? null,
      affiliate.limitation ?? null,
      cov.points < days ? `Phạm vi lịch sử thực tế chỉ ${cov.points} ngày, ít hơn ${days} ngày yêu cầu.` : null,
    ].filter(Boolean),
  };
}

export interface ProductDeepAnalysisInput {
  mode?: unknown;
  days?: unknown;
  force?: unknown;
}

export async function createProductDeepAnalysis(productId: number, input: ProductDeepAnalysisInput = {}) {
  const mode = parseMode(input.mode);
  const days = Number.isFinite(Number(input.days)) ? Math.min(90, Math.max(7, Math.trunc(Number(input.days)))) : 30;
  const force = input.force === true;

  const context = await buildContext(productId, days, mode);
  const fingerprint = hash({ version: PROMPT_VERSION, productId, mode, days, context });
  const scope = 'PRODUCT_DEEP_ANALYSIS';

  // Quota + reservation mirror the existing provider counters.
  const bucket = new Date().toISOString().slice(0, 10);
  const ids = await db.$transaction(async (tx) => {
    await tx.$queryRaw`WITH locked AS MATERIALIZED (SELECT pg_advisory_xact_lock(63824197::bigint)) SELECT 1::integer AS acquired FROM locked`;
    const daily = await tx.aiUsageCounter.upsert({ where: { scope_bucket: { scope: 'GLOBAL_DAILY', bucket } }, create: { scope: 'GLOBAL_DAILY', bucket }, update: {} });
    const entity = await tx.aiUsageCounter.upsert({ where: { scope_bucket: { scope, bucket } }, create: { scope, bucket }, update: {} });
    if (daily.requestCount >= env.gemini.maxAnalysesPerDay) throw new AppError('Đã đạt giới hạn phân tích AI trong ngày.', 429, 'AI_RATE_LIMITED', { scope: 'GLOBAL_DAILY', current: daily.requestCount, limit: env.gemini.maxAnalysesPerDay });
    await tx.aiUsageCounter.update({ where: { id: daily.id }, data: { requestCount: { increment: 1 } } });
    await tx.aiUsageCounter.update({ where: { id: entity.id }, data: { requestCount: { increment: 1 } } });
    return [daily.id, entity.id];
  });

  try {
    const providerError = providerConfigurationError();
    if (providerError) throw providerError;

    if (!force) {
      const cached = await db.aiAnalysisReport.findFirst({
        where: { productId, status: 'COMPLETED', dataQuality: { path: ['fingerprint'], equals: fingerprint } },
        orderBy: { id: 'desc' },
      });
      if (cached) return serializeDeepReport(cached);
    }

    const generated = await generateTextWithGemini(
      context,
      SYSTEM_PROMPT,
      (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 60_000,
    );

    await db.$transaction(
      ids.map((id) => db.aiUsageCounter.update({ where: { id }, data: { inputTokens: { increment: generated.inputTokens }, outputTokens: { increment: generated.outputTokens } } })),
    );

    const usage = {
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      totalTokens: generated.totalTokens,
      estimatedCost: (generated.inputTokens * env.gemini.inputPricePerMillionTokens + generated.outputTokens * env.gemini.outputPricePerMillionTokens) / 1_000_000,
    };

    const saved = await persistDeepReport({ productId, mode, days, context, report: generated.report, fingerprint, model: providerModel(), usage });
    return serializeDeepReport(saved);
  } catch (error) {
    await db.$transaction(
      ids.map((id) => db.aiUsageCounter.update({ where: { id }, data: { requestCount: { decrement: 1 } } })),
    ).catch(() => undefined);
    throw error;
  }
}

async function persistDeepReport(input: {
  productId: number; mode: AnalysisMode; days: number; context: unknown; report: string; fingerprint: string; model: string; usage: Record<string, unknown>;
}) {
  const envelope = {
    version: 'product-deep-analysis-v1',
    mode: input.mode,
    days: input.days,
    context: input.context,
    content: input.report,
    usage: input.usage,
  };
  return db.aiAnalysisReport.create({
    data: {
      productId: input.productId,
      status: 'COMPLETED',
      model: input.model,
      requestedAt: new Date(),
      completedAt: new Date(),
      report: envelope as unknown as Prisma.InputJsonValue,
      dataQuality: { fingerprint: input.fingerprint, version: PROMPT_VERSION, mode: input.mode, days: input.days } as Prisma.InputJsonValue,
    },
  });
}

function serializeDeepReport(row: Awaited<ReturnType<typeof db.aiAnalysisReport.findFirst>>) {
  const envelope = row && row.report && typeof row.report === 'object' && !Array.isArray(row.report)
    ? row.report as Record<string, unknown>
    : null;
  const content = typeof envelope?.content === 'string' ? envelope.content : null;
  const usage = envelope && envelope.usage && typeof envelope.usage === 'object' ? envelope.usage as Record<string, unknown> : {};
  return {
    id: row!.id.toString(),
    productId: row!.productId,
    status: row!.status,
    model: row!.model,
    mode: envelope?.mode ?? null,
    days: envelope?.days ?? null,
    report: content,
    context: envelope?.context ?? null,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
    estimatedCost: usage.estimatedCost ?? null,
    requestedAt: row!.requestedAt.toISOString(),
    completedAt: row!.completedAt?.toISOString() ?? null,
    persisted: true,
  };
}

export async function getProductDeepAnalysis(productId: number) {
  const row = await db.aiAnalysisReport.findFirst({
    where: { productId, status: 'COMPLETED', dataQuality: { path: ['version'], equals: PROMPT_VERSION } },
    orderBy: { id: 'desc' },
  });
  return row ? serializeDeepReport(row) : null;
}

export async function listProductDeepAnalyses(productId: number) {
  const rows = await db.aiAnalysisReport.findMany({
    where: { productId, dataQuality: { path: ['version'], equals: PROMPT_VERSION } },
    orderBy: { id: 'desc' },
    take: 30,
  });
  return rows.map(serializeDeepReport);
}
