import { createApp } from './app.js';
import { env } from './config/env.js';
import { verifyDatasetDatabase, datasetDb, datasetPool } from './config/datasetDb.js';
import { createLogger } from './utils/logger.js';
import { toErrorMessage } from './utils/errors.js';

const logger = createLogger('server');

async function bootstrap(): Promise<void> {
  await verifyDatasetDatabase();
  logger.info('Kết nối PostgreSQL thành công');

  const app = createApp();

  // Dataset licenses are not approved for public/commercial publication.
  const server = app.listen(env.port, '127.0.0.1', () => {
    logger.info(`TikTok E-Commerce Analytics chạy tại http://localhost:${env.port}`);
    logger.info(`Dashboard: http://localhost:${env.port}/shop.html | Chi tiết: /detail.html?id=1`);

    logger.info('DATASET_V2: không fallback legacy; scraper và AI ngoài đang tắt.');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`Nhận tín hiệu ${signal}, đang tắt server...`);


    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 10_000).unref();
    });

    await datasetDb.$disconnect();
    await datasetPool.end();
    logger.info('Đã đóng tài nguyên. Tạm biệt!');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });

  server.on('error', (error) => {
    logger.error('Không thể khởi động HTTP server', error);
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.error(`Khởi động thất bại: ${toErrorMessage(error)}`);
  process.exit(1);
});
