/**
 * Tiện ích xử lý văn bản tiếng Việt: bỏ dấu, chuẩn hoá khoảng trắng,
 * so khớp từ khoá theo ranh giới từ để tránh false-positive.
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

export function foldText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function foldKeyword(keyword: string): string {
  return foldText(keyword);
}

/**
 * Trả về true nếu `foldedText` chứa bất kỳ từ khoá nào (đã hoặc chưa bỏ dấu).
 */
export function containsAnyKeyword(foldedText: string, keywords: readonly string[]): boolean {
  return countKeywordHits(foldedText, keywords) > 0;
}

export function countKeywordHits(foldedText: string, keywords: readonly string[]): number {
  if (!foldedText) return 0;
  const padded = ` ${foldedText} `;
  let hits = 0;

  for (const keyword of keywords) {
    const folded = foldKeyword(keyword);
    if (folded && padded.includes(` ${folded} `)) hits += 1;
  }

  return hits;
}

export function slugifyText(value: string): string {
  return foldText(value).replace(/\s+/g, '-').slice(0, 80);
}
