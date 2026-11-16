/** Kiểu dữ liệu công khai cho module TikTok Shop Commerce (VN). */

export type GrowthDirection = 'up' | 'down' | 'flat';

export interface PeriodMetric {
  /** Số ngày của kỳ đang xét (1 = hôm qua). */
  days: number;
  current: number;
  previous: number;
  /** current - previous (luôn >= 0 theo nghĩa "phát sinh thêm"). */
  delta: number;
  /** % thay đổi so với kỳ trước. */
  growthRate: number;
  direction: GrowthDirection;
  /** false khi thiếu snapshot baseline để so sánh. */
  hasBaseline: boolean;
}

export interface PeriodMetrics {
  days: number;
  gmv: PeriodMetric;
  sales: PeriodMetric;
  orders: PeriodMetric;
}

export interface MultiPeriodMetrics {
  /** Mốc khớp bộ lọc thời gian hiện tại. */
  primary: PeriodMetrics;
  /** Đủ 4 mốc: 1, 7, 30, 90 ngày. */
  periods: PeriodMetrics[];
}

export interface RangeMeta {
  key: string;
  label: string;
  /** Số ngày của cửa sổ đang chọn (today/yesterday = 1). */
  days: number;
  /**
   * Mốc neo của cửa sổ:
   * - `today`: kết thúc ở hôm nay (bao gồm hôm nay).
   * - `yesterday`: kết thúc ở hôm qua (không bao gồm hôm nay).
   */
  anchor: 'today' | 'yesterday';
}

export interface ShopCommerceVariant {
  id: number;
  platformSkuId: string;
  name: string | null;
  price: number | null;
  originalPrice: number | null;
  stock: number | null;
  soldCount: number | null;
  isAvailable: boolean;
  attributes: Record<string, string> | null;
}

export interface ShopCommerceProductCard {
  id: number;
  platformProductId: string;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  shopId: number | null;
  shopName: string;
  price: number;
  minPrice: number | null;
  maxPrice: number | null;
  minOriginalPrice: number | null;
  maxOriginalPrice: number | null;
  variantCount: number;
  stockTotal: number | null;
  ratingScore: number | null;
  ratingCount: number;
  soldCount: number;
  sellerCount: number;
  gmv: number;
  growthRate: number;
  growth: MultiPeriodMetrics;
  lastSeenAt: string | null;
}

export interface ShopCommerceProductDetail extends ShopCommerceProductCard {
  description: string | null;
  currency: string;
  region: string;
  firstSeenAt: string | null;
  variants: ShopCommerceVariant[];
  timeline: Array<{ date: string; gmv: number; sales: number }>;
  revenueSources: {
    video: number;
    live: number;
    cart: number;
    productCard: number;
    total: number;
    isEstimated: boolean;
  };
  topTrendVideos: ShopCommerceTrendVideo[];
  topCreators: ShopCommerceCreatorCard[];
  shop: {
    id: number;
    name: string;
    avatarUrl: string | null;
    bannerUrl: string | null;
    shopUrl: string | null;
  } | null;
}

export interface ShopCommerceTrendVideo {
  id: number;
  platformVideoId: string | null;
  content: string;
  author: string | null;
  videoUrl: string | null;
  coverUrl: string | null;
  playCount: number;
  /** Alias của playCount để UI hiển thị "lượt xem". */
  viewsCount: number;
  diggCount: number;
  shareCount: number;
  commentCount: number;
  engagementRate: number;
  productId: number | null;
  shopId: number | null;
  scrapedAt: string | null;
}

/**
 * Item trong khối "Top Trend Video" của Dashboard.
 *
 * - `kind: 'video'` : bản ghi thật từ bảng TrendItem.
 * - `kind: 'product'`: fallback minh bạch khi chưa có TrendItem — dùng sản phẩm
 *   bán chạy nhất thực tế trong DB (kèm imageUrl/coverUrl, soldCount, price).
 */
export interface ShopCommerceHomeTrendItem extends ShopCommerceTrendVideo {
  kind: 'video' | 'product';
  /** Ảnh sản phẩm/video dùng cho fallback hiển thị. */
  imageUrl: string | null;
  /** Số bán thực tế (chỉ có ý nghĩa với kind = product). */
  soldCount: number;
  /** Giá bán thực tế (chỉ có ý nghĩa với kind = product). */
  price: number;
}

export interface ShopCommerceCreatorProduct {
  id: number;
  title: string;
  imageUrl: string | null;
  price: number | null;
  sales: number | null;
  gmv: number | null;
}

export interface ShopCommerceCreatorCard {
  id: number;
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  followerCount: number | null;
  engagementRate: number | null;
  gmv: number | null;
  soldCount: number | null;
  videoCount: number | null;
  growthRate: number;
  growth: MultiPeriodMetrics;
  topProducts: ShopCommerceCreatorProduct[];
}

export interface ShopCommerceCreatorDetail extends ShopCommerceCreatorCard {
  bio: string | null;
  region: string;
  shops: Array<{ id: number; name: string; avatarUrl: string | null; gmv: number | null }>;
  timeline: Array<{ date: string; gmv: number | null; followers: number | null; soldCount: number | null }>;
  topTrendVideos: ShopCommerceTrendVideo[];
}

export interface ShopCommerceShopCard {
  id: number;
  platformShopId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  shopUrl: string | null;
  productCount: number;
  followerCount: number | null;
  ratingScore: number | null;
  ratingCount: number | null;
  totalGmv: number;
  totalSales: number;
  avgOrderValue: number;
  avgPrice: number;
  growthRate: number;
  growth: MultiPeriodMetrics;
  revenueSources: {
    video: number;
    live: number;
    cart: number;
    productCard: number;
    total: number;
    videoShare: number;
    liveShare: number;
    cartShare: number;
    productCardShare: number;
    isEstimated: boolean;
  };
  lastSeenAt: string | null;
  topProducts: ShopCommerceProductCard[];
}

export interface ShopCommerceShopDetail extends ShopCommerceShopCard {
  firstSeenAt: string | null;
  /** Số bán phát sinh theo ngày (giữ cho tương thích). */
  salesTimeline: Array<{ date: string; value: number }>;
  /** Doanh thu GMV phát sinh theo ngày = price × ΔsoldCount từ snapshot. */
  gmvTimeline: Array<{ date: string; value: number }>;
  newProducts: ShopCommerceProductCard[];
  topAffiliates: ShopCommerceCreatorCard[];
  topTrendVideos: ShopCommerceTrendVideo[];
}

export interface ShopCommerceCategoryCard {
  name: string;
  productCount: number;
  shopCount: number;
  totalGmv: number;
  totalSales: number;
  totalViews: number;
  avgPrice: number;
  shareOfGmv: number;
  growthRate: number;
  growth: MultiPeriodMetrics;
  topSubCategory: string | null;
}

export interface ShopCommerceCategoryDetail extends ShopCommerceCategoryCard {
  subCategories: Array<ShopCommerceCategoryCard & { category: string }>;
  timeline: Array<{ date: string; value: number }>;
  topProducts: ShopCommerceProductCard[];
}

export interface ShopCommerceHome {
  range: RangeMeta;
  totals: {
    products: number;
    shops: number;
    creators: number;
    trendVideos: number;
    totalGmv: number;
    totalSales: number;
    avgOrderValue: number;
  };
  growth: MultiPeriodMetrics;
  topProducts: ShopCommerceProductCard[];
  topShops: ShopCommerceShopCard[];
  topCreators: ShopCommerceCreatorCard[];
  topTrendVideos: ShopCommerceHomeTrendItem[];
  topCategories: ShopCommerceCategoryCard[];
  revenueTimeline: Array<{ date: string; value: number }>;
}
