import prisma from '../config/db.js';
import { CATEGORY_RULES } from '../config/taxonomy.js';
import { createLogger } from '../utils/logger.js';
import { slugify, uniqueSlug } from '../utils/slug.js';

const logger = createLogger('category-catalog');

/**
 * Đồng bộ taxonomy tĩnh (src/config/taxonomy.ts) vào DB.
 * Idempotent: chạy nhiều lần không tạo trùng, chỉ cập nhật sortOrder/isActive.
 */
export async function syncCategoryCatalog(): Promise<{ categories: number; subCategories: number }> {
  let categoryCount = 0;
  let subCategoryCount = 0;

  const usedCategorySlugs = new Set<string>();

  for (const [index, rule] of CATEGORY_RULES.entries()) {
    const categorySlug = uniqueSlug(rule.name, usedCategorySlugs);

    const category = await prisma.category.upsert({
      where: { name: rule.name },
      update: { sortOrder: index, isActive: true },
      create: {
        name: rule.name,
        slug: categorySlug,
        sortOrder: index,
        isActive: true,
      },
      select: { id: true },
    });
    categoryCount += 1;

    const usedSubSlugs = new Set<string>();
    for (const [subIndex, sub] of rule.subCategories.entries()) {
      await prisma.subCategory.upsert({
        where: { categoryId_name: { categoryId: category.id, name: sub.name } },
        update: { sortOrder: subIndex, isActive: true },
        create: {
          categoryId: category.id,
          name: sub.name,
          slug: uniqueSlug(sub.name, usedSubSlugs),
          sortOrder: subIndex,
          isActive: true,
        },
      });
      subCategoryCount += 1;
    }
  }

  logger.info(`Đồng bộ danh mục: ${categoryCount} ngành, ${subCategoryCount} ngành con`);
  return { categories: categoryCount, subCategories: subCategoryCount };
}

/**
 * Đảm bảo category/subCategory tồn tại (dùng khi ingest sản phẩm mới).
 * Không throw nếu DB lỗi — chỉ log để pipeline cào không bị chặn.
 */
export async function ensureCategory(categoryName: string | null, subCategoryName: string | null): Promise<void> {
  const name = categoryName?.trim();
  if (!name) return;

  try {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name, slug: slugify(name), sortOrder: 999, isActive: true },
      select: { id: true },
    });

    const subName = subCategoryName?.trim();
    if (subName) {
      await prisma.subCategory.upsert({
        where: { categoryId_name: { categoryId: category.id, name: subName } },
        update: {},
        create: { categoryId: category.id, name: subName, slug: slugify(subName), sortOrder: 999, isActive: true },
      });
    }
  } catch (error) {
    logger.warn(`Không thể đồng bộ category "${name}"`, error);
  }
}

export async function listCategoryCatalog() {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      subCategories: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, slug: true, sortOrder: true },
      },
    },
  });

  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    sortOrder: category.sortOrder,
    subCategories: category.subCategories,
  }));
}
