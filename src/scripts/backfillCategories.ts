/**
 * Backfill phân loại ngành hàng cho dữ liệu cũ.
 * Chạy: npm run db:backfill  (sau khi đã build)
 */
import prisma, { disconnectDatabase } from '../config/db.js';
import { classifyProduct } from '../utils/classifier.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('backfill-categories');
const BATCH_SIZE = 50;

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    select: { id: true, title: true, description: true, category: true, subCategory: true },
  });

  let updated = 0;
  let unchanged = 0;
  let index = 0;

  for (let offset = 0; offset < products.length; offset += BATCH_SIZE) {
    const batch = products.slice(offset, offset + BATCH_SIZE);
    const operations = [];

    for (const product of batch) {
      index += 1;
      const classification = classifyProduct({
        title: product.title,
        description: product.description,
        rawCategory: product.category,
      });

      if (classification.category === product.category && classification.subCategory === product.subCategory) {
        unchanged += 1;
        continue;
      }

      operations.push(
        prisma.product.update({
          where: { id: product.id },
          data: { category: classification.category, subCategory: classification.subCategory },
        }),
      );
    }

    if (operations.length > 0) {
      await prisma.$transaction(operations);
      updated += operations.length;
    }

    logger.info(`Đã xử lý ${index}/${products.length} sản phẩm`);
  }

  logger.info(`Hoàn tất: cập nhật ${updated}, giữ nguyên ${unchanged}, tổng ${products.length}`);
}

main()
  .catch((error) => {
    logger.error('Backfill thất bại', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
