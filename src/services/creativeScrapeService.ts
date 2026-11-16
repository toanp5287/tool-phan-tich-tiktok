import prisma from '../config/db.js';
import { env } from '../config/env.js';
import { JOB_TRIGGER, SOURCE } from '../config/constants.js';
import { createLogger } from '../utils/logger.js';
import { AppError, toErrorMessage } from '../utils/errors.js';
import { toBucketDate } from '../utils/dates.js';
import { toOptionalBigInt, toOptionalDecimal } from '../utils/numbers.js';
import { createScrapeJob, markJobCompleted, markJobFailed } from './jobService.js';
import {
  fetchCreativeCenterItems,
  normalizeCreativeCreator,
  type CreativeFetchResult,
} from './scraper/apifyCreativeService.js';

const logger = createLogger('creative-scraper');

export const CREATIVE_SYNC_JOB_TYPE = 'CREATIVE_SYNC' as const;

export interface CreativeScrapeResult {
  jobId: number;
  source: string;
  creatorsFound: number;
  creatorsSaved: number;
  failed: number;
  durationMs: number;
}

let activeCreativeRun: Promise<CreativeScrapeResult> | null = null;

export function isCreativeScrapeRunning(): boolean {
  return activeCreativeRun !== null;
}

/**
 * Pipeline cào Creative Center (creator/affiliate) bổ sung cho pipeline profile.
 * Chỉ chạy khi APIFY_CREATIVE_ENABLED=true hoặc gọi thủ công.
 */
export async function runCreativeScrapePipeline(options: {
  trigger?: string;
  region?: string;
  period?: '7' | '30' | '90' | '120';
  force?: boolean;
} = {}): Promise<CreativeScrapeResult> {
  if (env.scrape.shopOnly) {
    throw new AppError('Creative scraping is disabled in strict TikTok Shop-only mode.', 403, 'SHOP_ONLY_MODE');
  }

  if (activeCreativeRun && !options.force) {
    logger.warn('Bỏ qua: creative scrape pipeline đang chạy');
    return activeCreativeRun;
  }

  activeCreativeRun = executeCreativePipeline(options).finally(() => {
    activeCreativeRun = null;
  });

  return activeCreativeRun;
}

async function executeCreativePipeline(options: {
  trigger?: string;
  region?: string;
  period?: '7' | '30' | '90' | '120';
}): Promise<CreativeScrapeResult> {
  const startedAt = Date.now();
  const region = options.region ?? 'VN';
  const period = options.period ?? '30';

  const job = await createScrapeJob({
    source: SOURCE.APIFY,
    jobType: CREATIVE_SYNC_JOB_TYPE,
    trigger: options.trigger ?? JOB_TRIGGER.MANUAL,
    region,
    metadata: { actor: env.apify.creativeActor, period },
  });

  try {
    const result: CreativeFetchResult = await fetchCreativeCenterItems({
      sections: ['creators'],
      region,
      period,
      resultsPerPage: env.apify.profileResultsPerPage,
    });

    const bucketDate = toBucketDate(new Date());
    let saved = 0;
    let failed = 0;

    for (const item of result.items) {
      const normalized = normalizeCreativeCreator(item);
      if (!normalized) continue;

      try {
        const creator = await prisma.creator.upsert({
          where: {
            platformCreatorId_source: {
              platformCreatorId: normalized.platformCreatorId,
              source: SOURCE.APIFY,
            },
          },
          update: {
            displayName: normalized.displayName,
            ...(normalized.username ? { username: normalized.username } : {}),
            ...(normalized.avatarUrl ? { avatarUrl: normalized.avatarUrl } : {}),
            ...(normalized.followerCount !== null ? { followerCount: toOptionalBigInt(normalized.followerCount) } : {}),
            ...(normalized.engagementRate !== null
              ? { engagementRate: toOptionalDecimal(normalized.engagementRate) }
              : {}),
            ...(normalized.gmvTotal !== null ? { gmvTotal: toOptionalDecimal(normalized.gmvTotal) } : {}),
            ...(normalized.soldCount !== null ? { soldCount: toOptionalBigInt(normalized.soldCount) } : {}),
            ...(normalized.videoCount !== null ? { videoCount: Math.trunc(normalized.videoCount) } : {}),
            lastSeenAt: new Date(),
          },
          create: {
            platformCreatorId: normalized.platformCreatorId,
            source: SOURCE.APIFY,
            username: normalized.username,
            displayName: normalized.displayName,
            avatarUrl: normalized.avatarUrl,
            role: 'CREATOR',
            region,
            followerCount: toOptionalBigInt(normalized.followerCount),
            engagementRate: toOptionalDecimal(normalized.engagementRate),
            gmvTotal: toOptionalDecimal(normalized.gmvTotal),
            soldCount: toOptionalBigInt(normalized.soldCount),
            videoCount: normalized.videoCount === null ? null : Math.trunc(normalized.videoCount),
          },
          select: { id: true },
        });

        const snapshotData = {
          followerCount: toOptionalBigInt(normalized.followerCount),
          engagementRate: toOptionalDecimal(normalized.engagementRate),
          gmvTotal: toOptionalDecimal(normalized.gmvTotal),
          soldCount: toOptionalBigInt(normalized.soldCount),
          videoCount: normalized.videoCount === null ? null : Math.trunc(normalized.videoCount),
          isEstimated: normalized.engagementRate === null,
        };

        await prisma.creatorSnapshot.upsert({
          where: {
            creatorId_source_bucketDate: { creatorId: creator.id, source: SOURCE.APIFY, bucketDate },
          },
          update: snapshotData,
          create: {
            creatorId: creator.id,
            scrapeJobId: job.id,
            source: SOURCE.APIFY,
            bucketDate,
            ...snapshotData,
          },
        });

        saved += 1;
      } catch (error) {
        failed += 1;
        if (failed <= 5) logger.warn(`Bỏ qua creator: ${toErrorMessage(error)}`);
      }
    }

    await markJobCompleted(job.id, {
      status: failed === 0 ? 'COMPLETED' : saved > 0 ? 'PARTIAL' : 'FAILED',
      recordsFound: result.items.length,
      recordsSaved: saved,
      recordsUpdated: 0,
      recordsFailed: failed,
      metadata: { runId: result.runId, datasetId: result.datasetId, attempts: result.attempts },
    });

    const summary: CreativeScrapeResult = {
      jobId: job.id,
      source: SOURCE.APIFY,
      creatorsFound: result.items.length,
      creatorsSaved: saved,
      failed,
      durationMs: Date.now() - startedAt,
    };

    logger.info('Creative scrape hoàn tất', summary);
    return summary;
  } catch (error) {
    await markJobFailed(job.id, error);
    logger.error('Creative scrape thất bại', toErrorMessage(error));
    throw error;
  }
}
