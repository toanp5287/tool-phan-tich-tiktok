export type PriceSegmentCode = 'under-100k' | '100k-300k' | '300k-500k' | 'over-500k';

export interface PriceSegmentDefinition {
  code: PriceSegmentCode;
  label: string;
  shortLabel: string;
  minPrice: number;
  maxPrice: number | null;
}

export interface PriceSegmentVariantItem {
  id: number;
  platformSkuId: string;
  name: string | null;
  price: number | null;
  stock: number | null;
  attributes: Record<string, string> | null;
  segmentCode: PriceSegmentCode | null;
  lastSeenAt: string | null;
}

export interface PriceSegmentProductItem {
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
  minPrice: number;
  maxPrice: number;
  hasPriceRange: boolean;
  priceRangeLabel: string;
  variantCount: number;
  matchedSegments: PriceSegmentCode[];
  primarySegment: PriceSegmentCode;
  sales: number;
  gmv: number;
  views: number;
  likes: number;
  shares: number;
  growthRate: number;
  lastSeenAt: string | null;
  capturedAt: string | null;
  variants: PriceSegmentVariantItem[];
}

export interface PriceSegmentSummary {
  code: PriceSegmentCode;
  label: string;
  shortLabel: string;
  minPrice: number;
  maxPrice: number | null;
  productCount: number;
  variantCount: number;
  shopCount: number;
  totalSales: number;
  totalGmv: number;
  totalViews: number;
  avgPrice: number;
  shareOfProducts: number;
  shareOfGmv: number;
}

export interface PriceSegmentOverview {
  totalProducts: number;
  multiVariantProducts: number;
  totalGmv: number;
  totalSales: number;
  totalViews: number;
  segments: PriceSegmentSummary[];
  categoryBreakdown: Array<{
    category: string;
    totalProducts: number;
    totalGmv: number;
    bySegment: Record<PriceSegmentCode, { products: number; gmv: number }>;
  }>;
}

export interface PriceSegmentFilterInput {
  segments?: PriceSegmentCode[];
  minPrice?: number | null;
  maxPrice?: number | null;
  category?: string;
  subCategory?: string;
  search?: string;
  shopId?: number;
  onlyMultiVariant?: boolean;
  sortBy?: 'gmv' | 'sales' | 'views' | 'price' | 'minPrice' | 'maxPrice' | 'variants' | 'recent';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface ProductVariantsDetail {
  productId: number;
  platformProductId: string;
  title: string;
  category: string | null;
  subCategory: string | null;
  minPrice: number;
  maxPrice: number;
  hasPriceRange: boolean;
  priceRangeLabel: string;
  variantCount: number;
  matchedSegments: PriceSegmentCode[];
  variants: PriceSegmentVariantItem[];
}
