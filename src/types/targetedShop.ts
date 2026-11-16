import type { ShopPriority } from '@prisma/client';

// ─── Per-shop scrape config (override global defaults) ─────────────────────
export interface ShopScrapeConfig {
  /** Số bản ghi tối đa / shop (default: 50) */
  resultsPerPage?: number;
  /** Các tab cần quét trong profile TikTok Shop */
  sections?: Array<'videos' | 'liked' | 'reposts' | 'shop_products'>;
  /** Kiểu sắp xếp feed của Apify */
  profileSorting?: 'latest' | 'popular';
  /** Timeout riêng (giây) - bỏ qua global nếu set */
  timeoutSecs?: number;
}

// ─── DB row shape trả về API ─────────────────────────────────────────────────
export interface TargetedShopItem {
  id: number;
  username: string;
  platformShopId: string | null;
  displayName: string | null;
  category: string | null;
  note: string | null;
  priority: ShopPriority;
  isActive: boolean;
  lastScrapedAt: string | null; // ISO
  scrapeCount: number;
  failCount: number;
  scrapeConfig: ShopScrapeConfig | null;
  createdAt: string;
  updatedAt: string;
}

// ─── API Request bodies ──────────────────────────────────────────────────────
export interface CreateTargetedShopBody {
  username: string;
  platformShopId?: string;
  displayName?: string;
  category?: string;
  note?: string;
  priority?: ShopPriority;
  isActive?: boolean;
  scrapeConfig?: ShopScrapeConfig;
}

export interface UpdateTargetedShopBody {
  displayName?: string;
  category?: string;
  note?: string;
  priority?: ShopPriority;
  isActive?: boolean;
  scrapeConfig?: ShopScrapeConfig | null;
}

// ─── Filter khi list / trigger scrape ────────────────────────────────────────
export interface TargetedShopFilters {
  category?: string;
  priority?: ShopPriority;
  isActive?: boolean;
  page: number;
  pageSize: number;
}

// ─── Input truyền vào pipeline cào targeted ─────────────────────────────────
export interface ProfileScrapeOptions {
  /** trigger: 'api' | 'cron' | 'manual' */
  trigger: string;
  /** Lọc theo category trước khi gửi Apify */
  category?: string;
  /** Lọc theo priority */
  priority?: ShopPriority;
  /** Bỏ qua guard "đang chạy" */
  force?: boolean;
  /** Vùng region (mặc định VN) */
  region?: string;
}

// ─── Kết quả pipeline cào targeted ─────────────────────────────────────────
export interface ProfileScrapeResult {
  jobId: number;
  source: string;
  shopsQueued: number;
  found: number;
  saved: number;
  updated: number;
  failed: number;
  skipped: number;
  durationMs: number;
}
