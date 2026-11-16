import { createLogger } from '../../utils/logger.js';
import type { IngestResult } from '../../types/scraper.js';
import { ingestRecords } from '../scraper/ingestionService.js';
import type { ScrapedRecord } from '../../types/scraper.js';

const logger = createLogger('echotik-ingestion');

export interface EchoTikIngestionOptions {
  jobId: number;
  source?: string;
  region?: string;
  currency?: string;
  concurrency?: number;
}

/**
 * Ingest dữ liệu EchoTik vào database
 * Sử dụng pipeline ingestion hiện tại với source = 'echotik'
 */
export async function ingestEchoTikRecords(
  records: readonly ScrapedRecord[],
  options: EchoTikIngestionOptions,
): Promise<IngestResult> {
  const source = options.source ?? 'echotik';

  logger.info(
    `Ingesting ${records.length} EchoTik records (job #${options.jobId}, source: ${source})`,
  );

  try {
    const result = await ingestRecords(records, {
      jobId: options.jobId,
      source,
      region: options.region ?? 'VN',
      currency: options.currency ?? 'VND',
      concurrency: options.concurrency ?? 4,
    });

    logger.info(
      `EchoTik ingestion completed: ${result.saved} saved, ${result.updated} updated, ${result.failed} failed`,
    );

    return result;
  } catch (error) {
    logger.error(`Failed to ingest EchoTik records: ${error}`);
    throw error;
  }
}

/**
 * Ingest một batch dữ liệu EchoTik (dùng bởi sync service)
 */
export async function ingestEchoTikBatch(
  records: readonly ScrapedRecord[],
  jobId: number,
): Promise<IngestResult> {
  return ingestEchoTikRecords(records, {
    jobId,
    source: 'echotik',
    region: 'VN',
    currency: 'VND',
    concurrency: 4,
  });
}
