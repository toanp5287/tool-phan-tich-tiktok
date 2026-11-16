import { findCategoryRule } from './taxonomy.js';

const categoryBySlug: Record<string, string> = {
  'me-be': 'Mẹ & Bé',
  'kids-fashion': 'Thời trang trẻ em',
};

const subCategoryBySlug: Record<string, string> = {
  'baby-clothing-shoes': 'Quần áo & Giày dép trẻ em',
  'baby-toys': 'Đồ chơi trẻ em',
  'nursing-feeding': 'Sữa & Dụng cụ ăn dặm',
};

export function categoryDisplayName(sourceName: string, slug: string): string {
  return categoryBySlug[slug] ?? findCategoryRule(sourceName)?.name ?? sourceName;
}

export function subCategoryDisplayName(sourceName: string, slug: string): string {
  return subCategoryBySlug[slug] ?? sourceName;
}
