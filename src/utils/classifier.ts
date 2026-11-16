import {
  CATEGORY_RULES,
  DEFAULT_CATEGORY,
  DEFAULT_SUB_CATEGORY,
  findCategoryRule,
  type CategoryRule,
} from '../config/taxonomy.js';
import { countKeywordHits, foldText } from './text.js';

export interface ClassificationInput {
  title?: string | null;
  description?: string | null;
  rawCategory?: string | null;
}

export interface ClassificationResult {
  category: string;
  subCategory: string;
  matched: boolean;
}

/**
 * Phân loại sản phẩm về ngành hàng chính + ngành con theo taxonomy nội bộ.
 * Ưu tiên category gốc do TikTok trả về; nếu không khớp mới suy luận từ tiêu đề/mô tả.
 */
export function classifyProduct(input: ClassificationInput): ClassificationResult {
  const rawCategory = input.rawCategory?.trim() ?? '';
  const exact = rawCategory ? findCategoryRule(rawCategory) : undefined;

  if (exact) {
    return {
      category: exact.name,
      subCategory: matchSubCategory(exact, foldText(input.title), foldText(input.description)),
      matched: true,
    };
  }

  const titleText = foldText(input.title);
  const bodyText = `${titleText} ${foldText(input.description)}`;
  const categoryText = foldText(rawCategory);

  const scores = CATEGORY_RULES.map((rule) => {
    const titleHits = countKeywordHits(titleText, rule.keywords) * 3;
    const bodyHits = countKeywordHits(bodyText, rule.keywords);
    const categoryHits = countKeywordHits(categoryText, rule.keywords) * 2;
    return { rule, score: titleHits + bodyHits + categoryHits };
  });

  const best = scores.reduce<(typeof scores)[number] | null>(
    (current, candidate) => (current === null || candidate.score > current.score ? candidate : current),
    null,
  );

  if (!best || best.score === 0) {
    return { category: DEFAULT_CATEGORY, subCategory: DEFAULT_SUB_CATEGORY, matched: false };
  }

  return {
    category: best.rule.name,
    subCategory: matchSubCategory(best.rule, titleText, bodyText),
    matched: true,
  };
}

function matchSubCategory(rule: CategoryRule, titleText: string, bodyText: string): string {
  const scores = rule.subCategories.map((sub) => ({
    name: sub.name,
    score: countKeywordHits(titleText, sub.keywords) * 3 + countKeywordHits(bodyText, sub.keywords),
  }));

  const best = scores.reduce<(typeof scores)[number] | null>(
    (current, candidate) => (current === null || candidate.score > current.score ? candidate : current),
    null,
  );

  return best && best.score > 0 ? best.name : DEFAULT_SUB_CATEGORY;
}
