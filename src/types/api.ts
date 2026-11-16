export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
  meta?: Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface MetricPoint {
  date: string;
  value: number;
}

export interface MetricSeries {
  sales: MetricPoint[];
  gmv: MetricPoint[];
  views: MetricPoint[];
  likes: MetricPoint[];
  price: MetricPoint[];
}

/* ------------------------------------------------------------------ */
/* Tăng trưởng đa mốc: 1 / 7 / 30 / 90 ngày                            */
/* ------------------------------------------------------------------ */

export interface GrowthMetric {
  days: 1 | 7 | 30 | 90;
  salesDiff: number;
  gmvDelta: number;
  salesGrowthRate: number;
  gmvGrowthRate: number;
  direction: 'up' | 'down' | 'flat';
  hasData: boolean;
}

export interface GrowthSummary {
  /** Mốc khớp bộ lọc thời gian hiện tại (dùng cho mũi tên lớn). */
  primary: GrowthMetric;
  /** Đủ 4 mốc để vẽ tooltip/bảng so sánh. */
  metrics: GrowthMetric[];
}

export interface ProductListItem {
  id: number;
  platformProductId: string;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  shopId: number | null;
  shopName: string;
  shopAvatarUrl: string | null;
  price: number;
  minPrice: number | null;
  maxPrice: number | null;
  minOriginalPrice: number | null;
  maxOriginalPrice: number | null;
  stockTotal: number | null;
  ratingScore: number | null;
  ratingCount: number;
  isAvailable: boolean;
  variantCount: number;
  sellerCount: number;
  sales: number;
  gmv: number;
  views: number;
  likes: number;
  shares: number;
  growthRate: number;
  /** Chênh lệch & xu hướng 1/7/30/90 ngày (salesDiff, Delta GMV). */
  growth: GrowthSummary;
  lastSeenAt: string | null;
  capturedAt: string | null;
  /** Nguồn dữ liệu (echotik hoặc apify) */
  source?: string;
}

export interface ProductDetail extends ProductListItem {
  description: string | null;
  currency: string;
  region: string;
  firstSeenAt: string | null;
  comments: number;
  soldCount1d: number;
  soldCount7d: number;
  soldCount30d: number;
  soldCount90d: number;
  sellerCount: number;
  minPrice: number | null;
  maxPrice: number | null;
  variantCount: number;
  variants: ProductVariantItem[];
  /** Video xu hướng hot nhất gắn với sản phẩm */
  topTrendVideo: TrendVideoItem | null;
  /** Các video xu hướng khác của sản phẩm */
  trendVideos: TrendVideoItem[];
  /** Top 10 creator/affiliate bán sản phẩm này */
  topCreators: CreatorCard[];
  shops: Array<{
    productShopId: number;
    shopId: number;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    shopUrl: string | null;
    isActive: boolean;
    price: number;
    sales: number;
    gmv: number;
  }>;
  history: MetricPoint[];
  historySeries: MetricSeries;
}

export interface ProductVariantItem {
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

export interface TrendVideoItem {
  id: number;
  platformVideoId: string | null;
  content: string;
  author: string | null;
  videoUrl: string | null;
  playCount: number;
  diggCount: number;
  shareCount: number;
  commentCount: number;
  engagementRate: number;
  scrapedAt: string | null;
}

/**
 * Item khối "Top Trend Video" của Dashboard.
 * - `kind: 'video'`  : bản ghi thật từ bảng TrendItem.
 * - `kind: 'product'`: fallback minh bạch khi TrendItem chưa có dữ liệu — dùng sản
 *   phẩm bán chạy nhất thực tế trong DB (kèm imageUrl/coverUrl, soldCount, price).
 */
export interface DashboardTrendItem extends TrendVideoItem {
  kind: 'video' | 'product';
  coverUrl: string | null;
  viewsCount: number;
  imageUrl: string | null;
  productId: number | null;
  shopId: number | null;
  soldCount: number;
  price: number;
}

export interface CreatorCard {
  id: number;
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  followerCount: number;
  engagementRate: number;
  gmv: number;
  soldCount: number;
  videoCount: number;
  growthRate: number;
  topProducts: CreatorProductItem[];
}

export interface CreatorProductItem {
  id: number;
  title: string;
  imageUrl: string | null;
  price: number;
  sales: number;
  gmv: number;
}

export interface ShopListItem {
  source?: string;
  linkedProductCount?: number;
  hasGmv?: boolean;
  hasSales?: boolean;
  metricsSource?: string | null;
  id: number;
  platformShopId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  productCount: number;
  totalSales: number;
  totalGmv: number;
  totalViews: number;
  avgPrice: number;
  avgOrderValue: number;
  followerCount: number;
  ratingScore: number | null;
  growthRate: number;
  /** Chênh lệch & xu hướng 1/7/30/90 ngày của shop. */
  growth: GrowthSummary;
  lastSeenAt: string | null;
  /** 3 sản phẩm bán chạy nhất của shop */
  topProducts?: Array<{ id: number; title: string; imageUrl: string | null; sales: number; gmv: number }>;
}

export interface ShopDetail {
  shop: ShopListItem & {
    shopUrl: string | null;
    firstSeenAt: string | null;
    followerCount: number;
    soldCountTotal: number;
    ratingCount: number;
  };
  products: ProductListItem[];
  salesTimeline: MetricPoint[];
  /** Doanh thu GMV phát sinh theo ngày = price × ΔsoldCount từ snapshot (bucketDate). */
  gmvTimeline: MetricPoint[];
  topProducts: Array<{ id: number; title: string; sales: number; gmv: number; price: number }>;
  /** Biểu đồ bóc tách nguồn tiền: Video vs Live vs Giỏ hàng vs Product card */
  revenueSources: ShopRevenueSources;
  /** Top 10 affiliate của shop */
  topAffiliates: CreatorCard[];
  /** Sản phẩm mới nhất trong 2 tuần gần đây */
  newProducts: ProductListItem[];
}

export interface ShopRevenueSources {
  series: Array<{
    date: string;
    video: number;
    live: number;
    cart: number;
    productCard: number;
    total: number;
  }>;
  summary: {
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
}

export interface TrendSummary {
  totalCurrent: number;
  totalPrevious: number;
  growthRate: number;
  trend: 'up' | 'down' | 'flat';
  label: string;
}

export interface DashboardOverview {
  dataQuality?: { hasProductMetrics: boolean; hasGmvRanking: boolean; categoryCatalogOnly: boolean };
  totals: {
    products: number;
    shops: number;
    snapshots: number;
    trackings: number;
    creators: number;
  };
  range: {
    key: string;
    label: string;
    days: number;
  };
  revenue: {
    totalGmv: number;
    totalSales: number;
    totalViews: number;
    avgOrderValue: number;
  };
  trend: TrendSummary;
  /** Xu hướng 1/7/30/90 ngày toàn hệ thống (mũi tên xanh/đỏ). */
  growth: GrowthSummary;
  lastJob: {
    id: number;
    source: string;
    status: string;
    trigger: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    recordsFound: number;
    recordsSaved: number;
    recordsFailed: number;
  } | null;
  /** Top 100 sản phẩm có nhiều người bán nhất (sellerCount) */
  topProducts: Array<{
    id: number;
    title: string;
    imageUrl: string | null;
    shopName: string;
    shopId: number | null;
    category: string | null;
    gmv: number;
    sales: number;
    sellerCount: number;
    price: number;
    growthRate: number;
  }>;
  topShops: Array<{ id: number; name: string; gmv: number; sales: number; productCount: number }>;
  topCreators: Array<{
    id: number;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
    gmv: number;
    soldCount: number;
    followerCount: number;
    engagementRate: number;
  }>;
  categoryBreakdown: Array<{ category: string; products: number; gmv: number }>;
  revenueTimeline: MetricPoint[];
  salesTimeline: MetricPoint[];
  /** Top sản phẩm bán chạy thực tế — fallback khi bảng TrendItem chưa có bản ghi. */
  topTrendVideos: DashboardTrendItem[];
  /** Danh mục ngành hàng (tương thích UI cũ). */
  topCategories: Array<{ name: string; totalGmv: number; shareOfGmv: number }>;
}

export interface CreatorListItem {
  id: number;
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  followerCount: number;
  engagementRate: number;
  gmv: number;
  soldCount: number;
  videoCount: number;
  growthRate: number;
  topProducts: CreatorProductItem[];
}

export interface CreatorDetail extends CreatorListItem {
  bio: string | null;
  region: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  products: Array<CreatorProductItem & { category: string | null; shopName: string }>;
  shops: Array<{ id: number; name: string; avatarUrl: string | null; gmv: number }>;
  timeline: Array<{ date: string; gmv: number; followers: number; soldCount: number }>;
  trendVideos: TrendVideoItem[];
}

export interface CategoryOverviewResponse {
  range: { key: string; label: string; days: number };
  overview: {
    categoryCount: number;
    totalGmv: number;
    totalSales: number;
    totalProducts: number;
    totalShops: number;
    growthRate: number;
  };
  categories: CategorySummary[];
}

/* ------------------------------------------------------------------ */
/* Mô hình phân cấp: Category -> Sub-category -> Shop -> Video         */
/* ------------------------------------------------------------------ */

export interface HierarchyStats {
  productCount: number;
  shopCount: number;
  totalSales: number;
  totalGmv: number;
  totalViews: number;
  avgPrice: number;
  growthRate: number;
}

export interface CategorySummary extends HierarchyStats {
  name: string;
  shareOfGmv: number;
  topSubCategory: string | null;
  comparableSales?: number;
  comparablePreviousSales?: number;
}

export interface SubCategorySummary extends HierarchyStats {
  name: string;
  category: string;
  shareOfGmv: number;
  comparableSales?: number;
  comparablePreviousSales?: number;
}

export interface HierarchyProduct {
  id: number;
  title: string;
  imageUrl: string | null;
  productUrl: string | null;
  shopId: number | null;
  shopName: string;
  price: number;
  sales: number;
  gmv: number;
  views: number;
  sellerCount: number;
  category: string | null;
  subCategory: string | null;
}

export interface CategoryDetail extends HierarchyStats {
  category: string;
  subCategories: SubCategorySummary[];
  timeline: MetricPoint[];
  topProducts: HierarchyProduct[];
}

export interface HierarchyShop {
  id: number;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  productCount: number;
  totalSales: number;
  totalGmv: number;
  totalViews: number;
  avgPrice: number;
  growthRate: number;
}

export interface SubCategoryDetail extends HierarchyStats {
  category: string;
  subCategory: string;
  shops: HierarchyShop[];
  timeline: MetricPoint[];
  topProducts: HierarchyProduct[];
}

export interface ShopVideoItem {
  productId: number;
  title: string;
  imageUrl: string | null;
  videoUrl: string | null;
  category: string | null;
  subCategory: string | null;
  price: number;
  sales: number;
  gmv: number;
  playCount: number;
  diggCount: number;
  shareCount: number;
  commentCount: number;
  capturedAt: string | null;
}

export interface ScrapeJobSummary {
  id: number;
  source: string;
  jobType: string;
  trigger: string;
  region: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  recordsFound: number;
  recordsSaved: number;
  recordsUpdated: number;
  recordsFailed: number;
  errorMessage: string | null;
  createdAt: string | null;
}
