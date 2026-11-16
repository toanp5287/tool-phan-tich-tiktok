import { createHash } from 'node:crypto';
import { datasetDb as db } from '../../config/datasetDb.js';
import { AppError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { parseMode, readSeries, buildGrowthSummary, competition, affiliateContribution, type AnalysisMode } from '../analyticsService.js';
import { generateTextWithGemini } from './geminiService.js';
import { providerConfigurationError, providerModel } from './aiProvider.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/**
 * Lightweight follow-up Q&A on top of a Product Deep Analysis.
 * Re-queries the Analytics Service for the specific context relevant to the
 * question (never re-sends the full report), keeps a bounded conversation
 * history, and answers with concrete figures — never generic prose.
 */
export async function askProductFollowUp(productId: number, question: string, options: { mode?: unknown; history?: unknown[] } = {}) {
  const mode = parseMode(options.mode);
  const q = String(question ?? '').trim();
  if (!q) throw AppError.badRequest('Câu hỏi không được để trống');
  if (q.length > 2000) throw AppError.badRequest('Câu hỏi quá dài');

  // Bounded, question-relevant context from the shared analytics service.
  const [sales, gmv, price] = await Promise.all([
    readSeries('PRODUCT', productId, 'soldCount', mode),
    readSeries('PRODUCT', productId, 'gmv', mode),
    readSeries('PRODUCT', productId, 'price', mode),
  ]);
  const growth = buildGrowthSummary(sales, gmv, 30);
  const comp = await competition(productId, mode);
  const affiliate = await affiliateContribution(productId, mode);

  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, title: true, currency: true } });
  if (!product) throw AppError.notFound(`Không tìm thấy sản phẩm #${productId}`);

  const context = {
    mode,
    product: { id: product.id, title: product.title, currency: product.currency },
    currentSales: [...sales].reverse().find((p) => p.value !== null)?.value ?? null,
    currentGmv: [...gmv].reverse().find((p) => p.value !== null)?.value ?? null,
    currentPrice: [...price].reverse().find((p) => p.value !== null)?.value ?? null,
    growth30d: growth.periods.find((p) => p.days === 30),
    growth7d: growth.periods.find((p) => p.days === 7),
    competition: comp,
    affiliate: { creatorCount: affiliate.creatorCount, sold: affiliate.sold, gmv: affiliate.gmv, share: affiliate.share },
  };

  const history = Array.isArray(options.history) ? options.history.slice(-6).map((h) => {
    const item = h as Record<string, unknown>;
    return { role: typeof item.role === 'string' ? item.role : 'user', content: String(item.content ?? '').slice(0, 2000) };
  }) : [];

  const systemPrompt = `Bạn là trợ lý phân tích sản phẩm TikTok Shop. Trả lời câu hỏi tiếp theo của người dùng bằng tiếng Việt, DỰA DUY NHẤT vào số liệu trong context và lịch sử hội thoại. Trả lời ngắn gọn, có số liệu cụ thể, không bịa số, không lặp lại toàn bộ báo cáo. Nếu dữ liệu thiếu để trả lời, ghi rõ "chưa đủ dữ liệu". Chế độ SIMULATION phải mở đầu bằng "⚠️ Mô phỏng: ". Không dùng HTML hay code fence.`;

  const userPayload = JSON.stringify({
    question: q,
    context,
    history,
  });

  const providerError = providerConfigurationError();
  if (providerError) throw providerError;

  const generated = await generateTextWithGemini(
    { context, history, question: q },
    systemPrompt,
    (v) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= 20_000,
  );

  return {
    productId,
    mode,
    question: q,
    answer: generated.report,
    context,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    totalTokens: generated.totalTokens,
    model: providerModel(),
  };
}
