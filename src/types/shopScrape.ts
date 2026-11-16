import type { Prisma } from '@prisma/client';

/**
 * Payload thô từ Apify Actor TikTok Shop.
 *
 * Hỗ trợ 2 schema:
 *  - `memo23/tiktok-shop-scraper` (hỗ trợ region VN) — field: price/priceMax,
 *    rating, reviewCount, images[], categories[], shop{}, relatedVideos[].
 *  - `clockworks/tiktok-shop-scraper` — field: salePrice{value,currency}, variants[].
 *
 * Chỉ chứa trường thương mại điện tử — không có video/trend mạng xã hội.
 */
export interface RawShopItem {
  productId?: string | number;
  title?: string;
  description?: string;
  productUrl?: string;
  image?: string;
  images?: string[];
  variantId?: string | number;
  salePrice?: RawMoney | number | string | null;
  originalPrice?: RawMoney | number | string | null;
  /** memo23: giá thấp nhất / cao nhất của dải SKU. */
  price?: number | string | null;
  priceMax?: number | string | null;
  priceDisplay?: string;
  discount?: number | string | null;
  variants?: RawShopVariant[];
  skus?: RawShopVariant[];
  seller?: RawShopSeller | null;
  /** memo23 trả object shop; clockworks trả seller. */
  shop?: RawShopStore | null;
  /** memo23: rating là số; clockworks: object { score, reviewCount }. */
  rating?: number | string | RawShopRating | null;
  reviewCount?: number | string | null;
  soldCount?: number | string | null;
  labels?: string[];
  /** Một số Actor trả sẵn thông tin shop ở cấp item. */
  shop_name?: string;
  shop_url?: string;
  shop_id?: string | number;
  follower_count?: number | string;
  total_products?: number | string;
  average_rating?: number | string;
  rating_count?: number | string;
  product_list?: RawShopItem[];
  /** Danh mục: memo23 trả mảng `categories`, actor khác trả chuỗi. */
  category?: string | null;
  categories?: string[];
  category_url?: string | null;
  currency?: string;
  available?: boolean;
  detailed?: boolean;
  searchRank?: number;
  bestSellerRank?: number;
  /** Video đang bán sản phẩm (memo23) — ngữ cảnh thương mại, không phải trend giải trí. */
  relatedVideos?: RawShopVideo[];
  source?: { kind?: string; ref?: string } | string;
  scrapedAt?: string;
  /** Item lỗi do Actor trả về (không phải sản phẩm). */
  errorCode?: string;
  error?: string;
  [key: string]: unknown;
}

export interface RawMoney {
  value?: number | string | null;
  currency?: string | null;
}

export interface RawShopStore {
  name?: string;
  rating?: number | string;
  reviewCount?: number | string;
  soldCount?: number | string;
  productCount?: number | string;
  followers?: number | string;
  videoCount?: number | string;
  url?: string;
  /** Ảnh đại diện shop (nhiều tên field khác nhau tuỳ Actor). */
  avatarUrl?: string;
  logo?: string;
  avatar?: string;
  /** Ảnh bìa shop. */
  bannerUrl?: string;
  banner?: string;
  coverUrl?: string;
  cover?: string;
  [key: string]: unknown;
}

export interface RawShopVideo {
  id?: string | number;
  videoId?: string | number;
  awemeId?: string | number;
  url?: string;
  authorName?: string;
  authorId?: string;
  playCount?: number | string;
  likeCount?: number | string;
  commentCount?: number | string;
  shareCount?: number | string;
  uploadedAt?: string;
  adLabel?: string;
  /** Ảnh bìa video. */
  coverUrl?: string;
  cover?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  [key: string]: unknown;
}

export interface RawShopVariant {
  variantId?: string | number;
  skuId?: string | number;
  hasStock?: boolean;
  availableQuantity?: number | string | null;
  stock?: number | string | null;
  soldCount?: number | string | null;
  properties?: Array<{ name?: string; value?: string }>;
  /** memo23: attributes dạng { Flavor: "Chocolate" }. */
  attributes?: Record<string, string>;
  salePrice?: RawMoney | number | string | null;
  originalPrice?: RawMoney | number | string | null;
  price?: number | string | null;
  image?: string | null;
  [key: string]: unknown;
}

export interface RawShopSeller {
  sellerId?: string | number;
  shopName?: string;
  shopLogoUrl?: string;
  shopUrl?: string;
  followerCount?: number | string;
  shopFollowerCount?: number | string;
  productCount?: number | string;
  [key: string]: unknown;
}

export interface RawShopRating {
  score?: number | string;
  reviewCount?: number | string;
  count?: number | string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Bản ghi đã chuẩn hoá                                               */
/* ------------------------------------------------------------------ */

export interface ScrapedShopVariant {
  platformSkuId: string;
  name: string | null;
  price: Prisma.Decimal | null;
  originalPrice: Prisma.Decimal | null;
  stock: number | null;
  soldCount: number | null;
  isAvailable: boolean;
  attributes: Record<string, string> | null;
}

export interface ScrapedShopProduct {
  platformProductId: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
  subCategory: string | null;
  currency: string;
  price: Prisma.Decimal | null;
  originalPrice: Prisma.Decimal | null;
  minPrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  minOriginalPrice: Prisma.Decimal | null;
  maxOriginalPrice: Prisma.Decimal | null;
  soldCount: number | null;
  sellerCount: number | null;
  stockTotal: number | null;
  ratingScore: Prisma.Decimal | null;
  ratingCount: number | null;
  isAvailable: boolean;
  variants: ScrapedShopVariant[];
  capturedAt: Date;
  rawData: Record<string, unknown>;
}

export interface ScrapedShopInfo {
  platformShopId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  shopUrl: string | null;
  followerCount: number | null;
  productCount: number | null;
  ratingScore: Prisma.Decimal | null;
  ratingCount: number | null;
}

export interface ScrapedShopAffiliate {
  platformCreatorId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  followerCount: number | null;
  engagementRate: Prisma.Decimal | null;
  gmvTotal: Prisma.Decimal | null;
  soldCount: number | null;
  videoCount: number | null;
}

export interface ScrapedShopRevenue {
  gmvVideo: Prisma.Decimal | null;
  gmvLive: Prisma.Decimal | null;
  gmvCart: Prisma.Decimal | null;
  gmvProductCard: Prisma.Decimal | null;
  gmvTotal: Prisma.Decimal | null;
  soldCountTotal: number | null;
  avgOrderValue: Prisma.Decimal | null;
  isEstimated: boolean;
}

/** Video đang bán sản phẩm (gắn productId/shopId) — chỉ ngữ cảnh thương mại. */
export interface ScrapedShopVideo {
  platformVideoId: string;
  content: string;
  author: string | null;
  /** ID tác giả video (creator/affiliate) do Actor trả về. */
  authorId: string | null;
  /** true khi nhãn quảng cáo của video cho biết creator hưởng hoa hồng. */
  isAffiliate: boolean;
  videoUrl: string | null;
  coverUrl: string | null;
  playCount: number | null;
  diggCount: number | null;
  shareCount: number | null;
  commentCount: number | null;
}

export interface ScrapedShopRecord {
  shop: ScrapedShopInfo;
  product: ScrapedShopProduct;
  affiliates: ScrapedShopAffiliate[];
  revenue: ScrapedShopRevenue | null;
  videos: ScrapedShopVideo[];
}

export interface ShopIngestResult {
  found: number;
  saved: number;
  updated: number;
  failed: number;
  skipped: number;
  errors: Array<{ index: number; message: string }>;
}

export interface ShopScrapeRunResult {
  jobId: number;
  source: string;
  keywords: string[];
  found: number;
  saved: number;
  updated: number;
  failed: number;
  skipped: number;
  durationMs: number;
  /** Số item thô Actor trả về (cơ sở tính chi phí thực tế). */
  rawCount?: number;
  /** Số profile creator tìm được từ Actor search (billed riêng). */
  creatorProfilesFound?: number;
  creatorProfilesSaved?: number;
  creatorProfilesFailed?: number;
}
