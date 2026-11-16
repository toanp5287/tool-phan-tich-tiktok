import type { Prisma, ScrapeJob } from '@prisma/client';
import prisma from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('job');

export interface CreateJobInput {
  source: string;
  jobType: string;
  trigger: string;
  region?: string;
  metadata?: Prisma.InputJsonValue;
}

export async function createScrapeJob(input: CreateJobInput): Promise<ScrapeJob> {
  return prisma.scrapeJob.create({
    data: {
      source: input.source,
      jobType: input.jobType,
      trigger: input.trigger,
      region: input.region ?? 'VN',
      status: 'RUNNING',
      startedAt: new Date(),
      metadata: input.metadata,
    },
  });
}

export async function markJobCompleted(
  jobId: number,
  payload: {
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
    recordsFound: number;
    recordsSaved: number;
    recordsUpdated: number;
    recordsFailed: number;
    errorMessage?: string | null;
    metadata?: Prisma.InputJsonValue;
  },
): Promise<void> {
  const job = await prisma.scrapeJob.findUnique({ where: { id: jobId }, select: { startedAt: true } });
  const durationMs = job?.startedAt ? Date.now() - job.startedAt.getTime() : null;

  await prisma.scrapeJob.update({
    where: { id: jobId },
    data: {
      status: payload.status,
      finishedAt: new Date(),
      durationMs,
      recordsFound: payload.recordsFound,
      recordsSaved: payload.recordsSaved,
      recordsUpdated: payload.recordsUpdated,
      recordsFailed: payload.recordsFailed,
      errorMessage: payload.errorMessage ?? null,
      ...(payload.metadata !== undefined ? { metadata: payload.metadata } : {}),
    },
  });

  logger.info(`Job #${jobId} -> ${payload.status}`, { durationMs, saved: payload.recordsSaved });
}

export async function markJobFailed(jobId: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const job = await prisma.scrapeJob.findUnique({ where: { id: jobId }, select: { startedAt: true } });
  const durationMs = job?.startedAt ? Date.now() - job.startedAt.getTime() : null;

  await prisma.scrapeJob
    .update({
      where: { id: jobId },
      data: { status: 'FAILED', finishedAt: new Date(), durationMs, errorMessage: message.slice(0, 2000) },
    })
    .catch((updateError) => logger.error(`Không thể cập nhật job #${jobId}`, updateError));
}

export async function findRunningJob(jobType: string): Promise<ScrapeJob | null> {
  return prisma.scrapeJob.findFirst({
    where: { jobType, status: { in: ['PENDING', 'RUNNING'] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findLatestJob(): Promise<ScrapeJob | null> {
  return prisma.scrapeJob.findFirst({ orderBy: { createdAt: 'desc' } });
}

export async function getJobById(id: number): Promise<ScrapeJob> {
  const job = await prisma.scrapeJob.findUnique({ where: { id } });
  if (!job) throw AppError.notFound(`Không tìm thấy job #${id}`);
  return job;
}

/**
 * Dọn các job bị treo ở trạng thái RUNNING quá lâu (ví dụ server restart giữa chừng).
 */
export async function closeStaleJobs(maxAgeMinutes = 180): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);

  const result = await prisma.scrapeJob.updateMany({
    where: { status: { in: ['PENDING', 'RUNNING'] }, createdAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      finishedAt: new Date(),
      errorMessage: 'Job bị treo và được đánh dấu thất bại khi khởi động lại hệ thống.',
    },
  });

  if (result.count > 0) logger.warn(`Đã đóng ${result.count} job treo`);
  return result.count;
}
