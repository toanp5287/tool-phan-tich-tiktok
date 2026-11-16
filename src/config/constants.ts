export const SOURCE = {
  APIFY: 'APIFY_TIKTOK_SCRAPER',
  PLAYWRIGHT: 'PLAYWRIGHT_FALLBACK',
  APIFY_SHOP: 'APIFY_TIKTOK_SHOP',
  CREATOR_DISCOVERY: 'APIFY_CREATOR_SEARCH',
} as const;

export type ScrapeSource = (typeof SOURCE)[keyof typeof SOURCE];

export const JOB_TYPE = {
  FULL_SYNC: 'FULL_SYNC',
  TREND_SYNC: 'TREND_SYNC',
  PROFILE_SYNC: 'PROFILE_SYNC',
  SHOP_SYNC: 'SHOP_SYNC',
  SHOP_DETAIL: 'SHOP_DETAIL',
} as const;

/** Khoảng thời gian xu hướng hiển thị mũi tên tăng/giảm (delta GMV & sold). */
export const GROWTH_WINDOWS = [1, 7, 30, 90] as const;
export type GrowthWindow = (typeof GROWTH_WINDOWS)[number];

export const JOB_TRIGGER = {
  MANUAL: 'manual',
  CRON: 'cron',
  API: 'api',
  STARTUP: 'startup',
} as const;

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

export const SNAPSHOT_WINDOW_DAYS = {
  default: 30,
  max: 365,
} as const;

export const ANALYTICS_METRIC = {
  SOLD: 'sold',
  GMV: 'gmv',
  VIEWS: 'views',
  PRICE: 'price',
} as const;

export type AnalyticsMetric = (typeof ANALYTICS_METRIC)[keyof typeof ANALYTICS_METRIC];

export const METRIC_COLUMN: Record<AnalyticsMetric, string> = {
  sold: 'soldCountTotal',
  gmv: 'gmvTotal',
  views: 'playCount',
  price: 'price',
};
