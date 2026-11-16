import type { Prisma } from '@prisma/client';

export interface RawTikTokItem {
  id?: string | number;
  aweme_id?: string | number;
  text?: string;
  desc?: string;
  title?: string;
  createTime?: number | string;
  createTimeISO?: string;
  webVideoUrl?: string;
  url?: string;
  playCount?: number | string;
  diggCount?: number | string;
  shareCount?: number | string;
  commentCount?: number | string;
  downloadCount?: number | string;
  collectCount?: number | string;
  price?: number | string;
  authorMeta?: {
    id?: string | number;
    name?: string;
    nickName?: string;
    avatar?: string;
    fans?: number | string;
    following?: number | string;
    verified?: boolean;
  };
  shopName?: string;
  shopId?: string | number;
  shopUsername?: string;
  shopAvatar?: string;
  shopFollowerCount?: number | string;
  shopFollowers?: number | string;
  sellerId?: string | number;
  sellerName?: string;
  sellerCount?: number | string;
  shopCount?: number | string;

  creator?: Record<string, unknown>;
  creatorId?: string | number;
  creatorName?: string;
  creatorUsername?: string;
  creatorAvatar?: string;
  creatorFollowerCount?: number | string;
  creatorEngagementRate?: number | string;
  creatorGmv?: number | string;
  creatorSoldCount?: number | string;
  creatorVideoCount?: number | string;
  creatorRole?: string;
  isAffiliate?: boolean;

  gmvVideo?: number | string;
  gmvLive?: number | string;
  gmvCart?: number | string;
  gmvProductCard?: number | string;
  gmvTotal?: number | string;

  coverUrl?: string;
  covers?: { default?: string; origin?: string } | string[];
  hashtags?: Array<{ name?: string } | string>;
  musicMeta?: { musicName?: string; musicAuthor?: string };
  productInfo?: Record<string, unknown>;
  product?: Record<string, unknown>;
  item?: Record<string, unknown>;
  searchQuery?: string;
  [key: string]: unknown;
}

export interface ScrapedShopRecord {
  platformShopId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  shopUrl: string | null;
  followerCount: number | null;
  /** Bóc tách doanh thu theo nguồn tiền (video / live / cart / product card) */
  revenueBreakdown: ScrapedRevenueBreakdown | null;
}

export interface ScrapedRevenueBreakdown {
  gmvVideo: number | null;
  gmvLive: number | null;
  gmvCart: number | null;
  gmvProductCard: number | null;
  gmvTotal: number | null;
  isEstimated: boolean;
}

export interface ScrapedCreatorRecord {
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: 'CREATOR' | 'AFFILIATE';
  followerCount: number | null;
  engagementRate: number | null;
  gmvTotal: number | null;
  soldCount: number | null;
  videoCount: number | null;
}

export interface ScrapedVariantRecord {
  platformSkuId: string;
  name: string | null;
  price: Prisma.Decimal | null;
  stock?: number | null;
  /** Lượt bán tích luỹ của riêng biến thể (nếu payload có). */
  soldCount?: number | null;
  attributes?: Record<string, string> | null;
}

export interface ScrapedProductRecord {
  platformProductId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  price: number | null;
  salesTotal: number | null;
  gmvTotal: number | null;
  /** Số người bán cùng sản phẩm (nếu payload có) */
  sellerCount: number | null;
  /** Giá thấp nhất trong toàn bộ biến thể (null khi sản phẩm không có biến thể). */
  minPrice: Prisma.Decimal | null;
  /** Giá cao nhất trong toàn bộ biến thể (null khi sản phẩm không có biến thể). */
  maxPrice: Prisma.Decimal | null;
  /** Danh sách SKU/biến thể bóc tách được từ payload. */
  variants: ScrapedVariantRecord[];
  playCount: number | null;
  diggCount: number | null;
  shareCount: number | null;
  commentCount: number | null;
  isEstimated: boolean;
  capturedAt: Date;
  rawData: Record<string, unknown>;
}

export interface ScrapedRecord {
  platformVideoId: string | null;
  content: string;
  author: string | null;
  videoUrl: string | null;
  keywords: string[];
  trendMetrics: {
    playCount: number | null;
    diggCount: number | null;
    shareCount: number | null;
    commentCount: number | null;
  };
  shop: ScrapedShopRecord | null;
  creator: ScrapedCreatorRecord | null;
  product: ScrapedProductRecord;
}

export interface IngestResult {
  found: number;
  saved: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
}

export interface ScrapeRunResult {
  jobId: number;
  source: string;
  found: number;
  saved: number;
  updated: number;
  failed: number;
  skipped: number;
  durationMs: number;
  usedFallback: boolean;
}
