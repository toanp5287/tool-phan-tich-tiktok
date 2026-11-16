export type Row = Record<string, unknown>;
export const EXCLUDED_DEMO_PRODUCT = '1729427780723968911';
export function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected EchoTik object');
  return value as Row;
}
export function rows(response: unknown): Row[] {
  const envelope = object(response);
  if (envelope.code !== 0 && envelope.code !== '0') throw new Error('EchoTik business response is not successful');
  if (!Array.isArray(envelope.data)) throw new Error('EchoTik data must be an array');
  return envelope.data.map(object);
}
export function id(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe numeric external ID');
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing external ID');
  const result = String(value);
  if (!/^[0-9]+$/.test(result)) throw new Error('Invalid external ID');
  return result;
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function numeric(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  const result = String(value);
  return /^[0-9]+([.][0-9]+)?$/.test(result) ? result : null;
}
export function count(value: unknown): bigint | null {
  const result = numeric(value);
  return result && /^[0-9]+$/.test(result) ? BigInt(result) : null;
}
function jsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}
export function imageUrls(row: Row, field: string): string[] {
  const direct = text(row[field]);
  const value = jsonField(row[field]);
  const candidates = Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? (item as Row).url : null) : [direct];
  return [...new Set(candidates.filter((item): item is string => typeof item === 'string' && item.startsWith('https://')))];
}
export function description(row: Row): string | null {
  const value = jsonField(row.desc_detail);
  if (!Array.isArray(value)) return text(row.desc_detail);
  return value.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const item = part as Row;
    return text(item.text) ? [text(item.text)!] : Array.isArray(item.content) ? item.content.filter((v): v is string => typeof v === 'string') : [];
  }).join(String.fromCharCode(10)) || null;
}
export function metric(row: Row, field: string, monetary = false) {
  const value = numeric(row[field]);
  const estimated = field.startsWith('per_product_ifl_') || field.startsWith('total_video_sale_');
  return { value, state: value !== null ? (monetary ? 'UNVERIFIED' : estimated ? 'ESTIMATED' : 'PRESENT') : row[field] === null ? 'MISSING' : Object.hasOwn(row, field) ? 'UNVERIFIED' : 'NOT_OBSERVED', sourceField: field, isEstimated: estimated, unit: monetary ? null : 'count' };
}

export function mergePresent(base: Row, extra: Row): Row {
  return { ...base, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== null && value !== undefined && value !== '')) };
}

export function variants(row: Row) {
  const raw = jsonField(row.skus);
  if (!Array.isArray(raw)) return [];
  return raw.map(object).map((sku) => {
    const money = sku.real_price && typeof sku.real_price === 'object' ? object(sku.real_price) : {};
    const currency = text(money.currency);
    // ponytail: ambiguous localized prices stay raw; add provider-specific parsing only with verified units.
    const price = currency === 'VND' ? numeric(money.sale_price_decimal) ?? (/^[0-9]+$/.test(String(money.price_val ?? '')) ? numeric(money.price_val) : null) : null;
    return { externalId: id(sku.sku_id), price, currency, sourcePrice: text(money.price_str), stock: count(sku.stock)?.toString() ?? null };
  });
}
export function profile(row: Row, kind: 'PRODUCT' | 'SHOP' | 'CREATOR' | 'VIDEO') {
  const names = { PRODUCT: 'product_name', SHOP: 'seller_name', CREATOR: 'nick_name', VIDEO: 'video_desc' };
  const imageFields = { PRODUCT: 'cover_url', SHOP: 'cover_url', CREATOR: 'avatar', VIDEO: 'reflow_cover' };
  return {
    name: text(row[names[kind]]), images: imageUrls(row, imageFields[kind]),
    description: kind === 'PRODUCT' ? description(row) : kind === 'CREATOR' ? text(row.signature) : null,
    username: text(row.unique_id), region: text(row.region),
    playUrl: kind === 'VIDEO' && text(row.play_addr)?.startsWith('https://') ? text(row.play_addr) : null,
    publishedAtRaw: kind === 'VIDEO' ? text(row.create_time) ?? numeric(row.create_time) : null,
    durationRaw: kind === 'VIDEO' ? numeric(row.duration) : null,
    authorExternalId: kind === 'VIDEO' && row.user_id != null ? id(row.user_id) : null,
    authorType: 'UNKNOWN', urlAccess: 'UNVERIFIED',
  };
}
export function metrics(row: Row, kind: 'PRODUCT' | 'SHOP' | 'CREATOR' | 'VIDEO' | 'PRODUCT_CREATOR') {
  const fields = {
    PRODUCT: ['min_price', 'max_price', 'product_commission_rate', 'product_rating', 'review_count', 'total_sale_cnt', 'total_sale_gmv_amt', 'total_sale_7d_cnt', 'total_sale_30d_cnt', 'total_sale_gmv_30d_amt', 'total_video_cnt', 'total_ifl_cnt'],
    SHOP: ['followers_count', 'total_crawl_product_cnt', 'total_sale_cnt', 'total_sale_gmv_amt', 'rating', 'review_count', 'response_rate', 'delivery_rate'],
    CREATOR: ['total_followers_cnt', 'total_following_cnt', 'total_post_video_cnt', 'total_views_cnt', 'total_digg_cnt', 'total_likes_cnt', 'total_sale_cnt', 'total_sale_gmv_amt'],
    VIDEO: ['total_views_cnt', 'total_digg_cnt', 'total_comments_cnt', 'total_shares_cnt', 'total_favorites_cnt', 'total_video_sale_cnt', 'total_video_sale_gmv_amt'],
    PRODUCT_CREATOR: ['per_product_ifl_sale_cnt', 'per_product_ifl_gmv_amt'],
  };
  return Object.fromEntries(fields[kind].map((field) => [field, metric(row, field, /gmv|price|commission|rating|rate/.test(field))]));
}
export function chooseRelated(videoRows: Row[], creatorRows: Row[], productId: string) {
  const related = (items: Row[], key: string) => {
    const seen = new Set<string>();
    return items.filter((row) => {
      if (id(row.product_id) !== productId) throw new Error('Related row product_id mismatch');
      const externalId = id(row[key]);
      if (seen.has(externalId)) return false;
      seen.add(externalId);
      return true;
    });
  };
  const completeness = (row: Row) => Object.values(row).filter((v) => v !== null && v !== undefined && v !== '').length;
  const creators = related(creatorRows, 'user_id').sort((a, b) => completeness(b) - completeness(a)).slice(0, 3);
  const creatorIds = new Set(creators.map((row) => id(row.user_id)));
  const videos = related(videoRows, 'video_id').sort((a, b) => {
    const score = (row: Row) => completeness(row) + (text(row.play_addr) ? 10 : 0) + (text(row.reflow_cover) ? 5 : 0) + (row.user_id != null && creatorIds.has(id(row.user_id)) ? 10 : 0);
    return score(b) - score(a);
  }).slice(0, 2);
  if (videos.length !== 2 || creators.length !== 3) throw new Error('Insufficient linked data: require two distinct videos and three distinct creators');
  return { videos, creators };
}
