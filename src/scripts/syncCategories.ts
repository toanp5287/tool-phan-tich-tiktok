/**
 * Đồng bộ danh mục ngành hàng (Category/SubCategory) từ taxonomy tĩnh.
 * Chạy: npm run db:sync-categories  (sau khi build)
 */
import { disconnectDatabase } from '../config/db.js';
import { syncCategoryCatalog } from '../services/categoryCatalogService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('sync-categories');

syncCategoryCatalog()
  .then((result) => {
    logger.info(`Đồng bộ danh mục hoàn tất: ${result.categories} ngành, ${result.subCategories} ngành con`);
  })
  .catch((error) => {
    logger.error('Đồng bộ danh mục thất bại', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
