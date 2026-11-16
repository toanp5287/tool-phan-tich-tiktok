export type TrendDirection = 'up' | 'down' | 'flat';

/** Một chỉ số kèm so sánh kỳ hiện tại vs kỳ trước. */
export interface TrendMetric {
  current: number;
  previous: number;
  diff: number;
  changePercent: number;
  direction: TrendDirection;
}

/** Khoảng thời gian của một kỳ (theo bucketDate, UTC). */
export interface TrendPeriod {
  index: number;
  label: string;
  start: string;
  end: string;
  days: number;
}

export interface CategoryTrendMetrics {
  sales: TrendMetric;
  gmv: TrendMetric;
  views: TrendMetric;
  likes: TrendMetric;
  shares: TrendMetric;
  comments: TrendMetric;
  avgPrice: TrendMetric;
  products: TrendMetric;
  shops: TrendMetric;
  videos: TrendMetric;
}

export interface TrendTopProduct {
  id: number;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  shopName: string;
  price: number;
  sales: number;
  gmv: number;
  views: number;
  salesTrend: TrendMetric;
  gmvTrend: TrendMetric;
}

export interface TrendVideoItem {
  productId: number;
  title: string;
  imageUrl: string | null;
  videoUrl: string | null;
  shopName: string;
  category: string;
  subCategory: string;
  bucketDate: string | null;
  price: number;
  sales: number;
  gmv: number;
  playCount: number;
  diggCount: number;
  shareCount: number;
  commentCount: number;
  viewTrend: TrendMetric;
}

export interface TrendHashtagItem {
  hashtag: string;
  count: number;
  views: number;
  trend: TrendMetric;
}

export interface TrendSoundItem {
  name: string;
  author: string | null;
  count: number;
  views: number;
  trend: TrendMetric;
}

export interface CategoryTrendSummary {
  category: string;
  shareOfGmv: number;
  topSubCategory: string | null;
  metrics: CategoryTrendMetrics;
}

export interface TrendTimelinePoint {
  date: string;
  sales: number;
  gmv: number;
  views: number;
}

export interface CategoryTrendDetail {
  category: string;
  periods: TrendPeriod[];
  metrics: CategoryTrendMetrics;
  shareOfGmv: number;
  timeline: TrendTimelinePoint[];
  subCategories: Array<{
    name: string;
    shareOfGmv: number;
    metrics: CategoryTrendMetrics;
  }>;
  topProducts: TrendTopProduct[];
  topVideos: TrendVideoItem[];
  hashtags: TrendHashtagItem[];
  sounds: TrendSoundItem[];
}

export interface TrendTotals {
  sales: TrendMetric;
  gmv: TrendMetric;
  views: TrendMetric;
  products: TrendMetric;
  shops: TrendMetric;
}

export interface CategoryTrendOverview {
  periods: TrendPeriod[];
  totals: TrendTotals;
  categories: CategoryTrendSummary[];
}

export interface TrendComparisonRow {
  category: string;
  shareOfGmv: number;
  metrics: CategoryTrendMetrics;
}

export interface TrendComparison {
  periods: TrendPeriod[];
  totals: TrendTotals;
  rows: TrendComparisonRow[];
}
