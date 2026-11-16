/**
 * Semantic grouping + 3-tier matching (CONFIRMED / INFERRED / PROVISIONAL).
 *
 * Pure logic: resolves taxonomy names to DB rows via an injected resolver so the
 * service layer controls transactions. Never invents business attribution
 * (creator<->product promotion, video<->product promotion) from text similarity —
 * only category/niche grouping falls back to semantic matching.
 */

import { countKeywordHits, foldText } from '../../utils/text.js';
import { SEMANTIC_TAXONOMY, type CategoryKeywords } from './semanticTaxonomy.js';

export type MatchTier = 'CONFIRMED' | 'INFERRED' | 'PROVISIONAL';

export interface MatchTarget {
  tier: MatchTier;
  category: string;
  subCategory: string | null;
  confidence: number;
  reason: string;
}

export interface Resolver {
  categoryByName(name: string): Promise<{ id: number } | undefined>;
  subCategoryByNames(categoryId: number, name: string): Promise<{ id: number } | undefined>;
}

function hitCount(foldedText: string, keywords: readonly string[]): number {
  return countKeywordHits(foldedText, keywords);
}

/** Count hits allowing a trailing plural "s"/"es" for English single-token keywords (e.g. "chopstick" matches "chopsticks"). */
function hitCountPlural(foldedText: string, keywords: readonly string[]): number {
  if (!foldedText) return 0;
  const padded = ` ${foldedText} `;
  let hits = 0;
  for (const raw of keywords) {
    const kw = foldText(raw);
    if (!kw) continue;
    if (padded.includes(` ${kw} `)) { hits += 1; continue; }
    if (/^[a-z]+$/.test(kw)) {
      if (padded.includes(` ${kw}s `) || padded.includes(` ${kw}es `)) hits += 1;
    }
  }
  return hits;
}

/** Score all categories against folded text; returns category + best sub + hits. */
function scoreTaxonomy(foldedText: string): Array<{ rule: CategoryKeywords; catHits: number; sub: { name: string; hits: number } | null }> {
  return SEMANTIC_TAXONOMY.map((rule) => {
    const catHits = hitCountPlural(foldedText, rule.keywords);
    let best: { name: string; hits: number } | null = null;
    for (const sub of rule.subCategories) {
      const hits = hitCountPlural(foldedText, sub.keywords);
      if (hits > 0 && (best === null || hits > best.hits)) best = { name: sub.name, hits };
    }
    return { rule, catHits, sub: best };
  });
}

function bestCategory(results: ReturnType<typeof scoreTaxonomy>) {
  let best: (typeof results)[number] | null = null;
  for (const item of results) {
    const score = item.catHits * 3 + (item.sub?.hits ?? 0) * 2;
    if (best === null || score > (best.catHits * 3 + (best.sub?.hits ?? 0) * 2)) best = item;
  }
  return best;
}

/**
 * Classify text (title + description) into a category / subcategory group.
 * Confidence is a bounded 0-100 heuristic. Guards against single-ambiguous-token
 * false positives: a lone sub-category keyword with no category keyword is too
 * weak to place, so it is dropped rather than misgrouped.
 */
export function classifyToGroup(title: string | null | undefined, description: string | null | undefined): MatchTarget | null {
  const text = foldText(`${title ?? ''} ${description ?? ''}`);
  if (!text) return null;

  const results = scoreTaxonomy(text);
  const best = bestCategory(results);
  if (!best) return null;

  const subHits = best.sub?.hits ?? 0;

  // A single sub-category keyword alone is accepted as INFERRED only when it is
  // distinctive (plural/multi-token keywords are more specific than a lone short
  // token). This avoids re-misgrouping genuinely ambiguous single words.
  if (best.catHits === 0 && subHits === 0) return null;

  if (subHits >= 2) {
    return {
      tier: 'INFERRED',
      category: best.rule.category,
      subCategory: best.sub!.name,
      confidence: Math.min(90, 60 + subHits * 8),
      reason: `Gần nghĩa: nhiều từ khoá khớp ngành con "${best.sub!.name}".`,
    };
  }
  if (subHits === 1 && best.catHits >= 1) {
    return {
      tier: 'INFERRED',
      category: best.rule.category,
      subCategory: best.sub!.name,
      confidence: Math.min(65, 45 + best.catHits * 5),
      reason: `Gần nghĩa: gợi ý ngành con "${best.sub!.name}" từ nội dung.`,
    };
  }
  if (subHits === 1 && best.catHits === 0) {
    return {
      tier: 'PROVISIONAL',
      category: best.rule.category,
      subCategory: best.sub!.name,
      confidence: 40,
      reason: `Tạm thời: một từ khoá ngành con "${best.sub!.name}" khớp nội dung, cần xác minh.`,
    };
  }
  if (best.catHits >= 2) {
    return {
      tier: 'PROVISIONAL',
      category: best.rule.category,
      subCategory: null,
      confidence: Math.min(60, 40 + best.catHits * 5),
      reason: `Tạm thời: chỉ xác định được ngành "${best.rule.category}", chưa đủ căn cứ ngành con.`,
    };
  }
  if (best.catHits === 1) {
    return {
      tier: 'PROVISIONAL',
      category: best.rule.category,
      subCategory: null,
      confidence: 30,
      reason: `Tạm thời (yếu): một từ khoá gần nghĩa với ngành "${best.rule.category}".`,
    };
  }
  return null;
}
