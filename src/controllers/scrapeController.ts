import type { Request, Response } from 'express';
import { sendSuccess } from '../utils/http.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { JOB_TRIGGER } from '../config/constants.js';
import { isScrapeRunning, runScrapePipeline } from '../services/scrapeService.js';
import { findLatestJob, getJobById } from '../services/jobService.js';
import { createLogger } from '../utils/logger.js';
import { toIso } from '../utils/serializers.js';
import { clampInt } from '../utils/numbers.js';

const logger = createLogger('scrape-controller');

function assertAdmin(req: Request): void {
  if (!env.adminToken) return;

  const provided = req.header('x-admin-token') ?? '';
  if (provided !== env.adminToken) {
    throw AppError.unauthorized('Token quản trị không hợp lệ');
  }
}

export async function triggerScrape(req: Request, res: Response): Promise<void> {
  assertAdmin(req);

  if (isScrapeRunning()) {
    throw AppError.conflict('Một phiên cào dữ liệu đang chạy. Vui lòng thử lại sau.');
  }

  const force = req.query.force === 'true';

  void runScrapePipeline({ trigger: JOB_TRIGGER.API, force })
    .then((result) => logger.info('Phiên cào thủ công hoàn tất', result))
    .catch((error) => logger.error('Phiên cào thủ công thất bại', error));

  res.status(202).json({
    success: true,
    data: { message: 'Đã khởi chạy phiên cào dữ liệu. Theo dõi tiến trình qua /api/jobs.' },
  });
}

export async function getScrapeStatus(req: Request, res: Response): Promise<void> {
  const latest = await findLatestJob();

  sendSuccess(res, {
    running: isScrapeRunning(),
    config: {
      apifyConfigured: Boolean(env.apify.token),
      fallbackEnabled: env.scrape.fallbackEnabled && !env.scrape.shopOnly,
      shopOnly: env.scrape.shopOnly,
      cron: env.scrape.cron,
      timezone: env.timezone,
      profiles: env.apify.profiles,
      searchQueries: env.apify.searchQueries,
      resultsPerPage: env.apify.resultsPerPage,
    },
    job: latest
      ? {
          id: latest.id,
          source: latest.source,
          status: latest.status,
          trigger: latest.trigger,
          startedAt: toIso(latest.startedAt),
          finishedAt: toIso(latest.finishedAt),
          durationMs: latest.durationMs,
          recordsFound: latest.recordsFound,
          recordsSaved: latest.recordsSaved,
          recordsUpdated: latest.recordsUpdated,
          recordsFailed: latest.recordsFailed,
          errorMessage: latest.errorMessage,
        }
      : null,
  });
}

export async function getScrapeJob(req: Request, res: Response): Promise<void> {
  const id = clampInt(req.params.id, 1, Number.MAX_SAFE_INTEGER, 0);
  if (!id) throw AppError.badRequest('ID job không hợp lệ');

  const job = await getJobById(id);
  sendSuccess(res, job);
}
