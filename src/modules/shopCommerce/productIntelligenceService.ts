import prisma from '../../config/db.js';
import { AppError } from '../../utils/errors.js';

export async function listDemoProducts() {
  const jobs = await prisma.scrapeJob.findMany({ where: { source: 'echotik', jobType: 'ECHOTIK_DEMO', status: 'COMPLETED' }, orderBy: { finishedAt: 'desc' }, take: 20, select: { id: true, finishedAt: true } });
  const items = [];
  for (const job of jobs) {
    const observation = await prisma.intelligenceObservation.findFirst({ where: { scrapeJobId: job.id, kind: 'PRODUCT', source: 'echotik' }, select: { productId: true, data: true, externalId: true } });
    if (observation) items.push({ ...observation, collectionId: job.id, collectedAt: job.finishedAt });
  }
  return items;
}

export async function getProductIntelligence(productId: number) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, source: true, platformProductId: true } });
  if (!product || product.source !== 'echotik') throw AppError.notFound('Không tìm thấy sản phẩm demo EchoTik');
  const latest = await prisma.intelligenceObservation.findFirst({ where: { productId, kind: 'PRODUCT', source: 'echotik', job: { status: 'COMPLETED', jobType: 'ECHOTIK_DEMO' } }, orderBy: { capturedAt: 'desc' }, select: { scrapeJobId: true } });
  if (!latest) throw AppError.notFound('Sản phẩm chưa có bộ dữ liệu demo hoàn chỉnh');
  const [observations, job, history] = await Promise.all([
    prisma.intelligenceObservation.findMany({ where: { productId, scrapeJobId: latest.scrapeJobId, source: 'echotik' }, orderBy: { id: 'asc' } }),
    prisma.scrapeJob.findUnique({ where: { id: latest.scrapeJobId }, select: { id: true, status: true, metadata: true, startedAt: true, finishedAt: true } }),
    prisma.intelligenceObservation.findMany({ where: { productId, source: 'echotik' }, orderBy: { capturedAt: 'desc' }, take: 200, select: { kind: true, externalId: true, capturedAt: true, scrapeJobId: true } }),
  ]);
  const keys = [...new Set(observations.flatMap((row) => Array.isArray(row.rawRequestKeys) ? row.rawRequestKeys.filter((key): key is string => typeof key === 'string') : []))];
  const provenance = await prisma.echoTikRawResponse.findMany({ where: { requestKey: { in: keys }, source: 'echotik' }, select: { requestKey: true, endpoint: true, capturedAt: true } });
  return { product, collection: job, observations: observations.map(({ id, ...row }) => ({ ...row, id: id.toString() })), history, provenance, limitations: ['Dữ liệu từ kho offline EchoTik; không bảo đảm thời gian thực.', 'Đơn vị tiền tệ, tỷ lệ và attribution chưa xác minh được ghi rõ; không tự chuyển đổi sang VND.', 'Chỉ có metadata video, chưa tải hoặc phân tích nội dung video.', 'URL ảnh/play chưa được kiểm tra truy cập.'] };
}
