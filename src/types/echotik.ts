/**
 * EchoTik API Response Types
 * 
 * UNVERIFIED: Đây là interface tạm dựa trên dự kiến. 
 * Cần xác minh với doc API chính thức của EchoTik.
 */

export interface EchoTikProductData {
  productId: string; // ID sản phẩm từ EchoTik
  title: string;
  description?: string;
  category?: string; // L1 category
  subCategory?: string; // L2 category
  price?: number;
  originalPrice?: number;
  currency?: string;
  soldCount?: number;
  stock?: number;
  rating?: number;
  ratingCount?: number;
  imageUrl?: string;
  productUrl?: string;
  shop?: EchoTikShopData;
  variants?: EchoTikVariant[];
  isAvailable?: boolean;
  capturedAt?: Date;
}

export interface EchoTikVariant {
  skuId: string;
  name?: string;
  price?: number;
  originalPrice?: number;
  stock?: number;
  soldCount?: number;
  isAvailable?: boolean;
}

export interface EchoTikShopData {
  sellerId: string; // ID cửa hàng từ EchoTik
  name: string;
  username?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  shopUrl?: string;
  followerCount?: number;
  productCount?: number;
  soldCountTotal?: number;
  gmvTotal?: number;
  ratingScore?: number;
  ratingCount?: number;
  isAvailable?: boolean;
}

export interface EchoTikCategoryData {
  categoryId: string;
  name: string;
  level: 1 | 2 | 3; // L1, L2, or L3
  parentId?: string; // ID of parent category (for L2/L3)
  productCount?: number;
  gmvTotal?: number;
  soldCount?: number;
  trendingProducts?: string[]; // Array of product IDs
  description?: string;
}

export interface EchoTikSearchResponse {
  success: boolean;
  data: EchoTikProductData[];
  total: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  error?: string;
  errorCode?: string;
}

export interface EchoTikCategoryResponse {
  success: boolean;
  data: EchoTikCategoryData[];
  total: number;
  error?: string;
  errorCode?: string;
}

export interface EchoTikSellerResponse {
  success: boolean;
  data: EchoTikShopData;
  error?: string;
  errorCode?: string;
}

export interface EchoTikApiError {
  code: string;
  message: string;
  statusCode: number;
  retryable: boolean;
}

export interface EchoTikQuotaInfo {
  remainingQuota: number;
  totalQuota: number;
  resetDate: Date;
  requestsThisMonth: number;
}
