import 'dotenv/config';

function readString(name: string, fallback = ''): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function readInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(readString(name, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readString(name, '').toLowerCase();
  if (raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function readList(name: string, fallback: string[]): string[] {
  const raw = readString(name, '');
  if (!raw) return fallback;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

const DEFAULT_TARGET_PROFILES = [
  'tiktokshopvn',
  'tiktokshop_vietnam',
  'official_tiktokshop',
];

// Có thể dùng search query khi profile bị private/đổi username. Các query này
// được gửi cho Actor cùng profiles và không làm pipeline phụ thuộc một shop đơn lẻ.
const DEFAULT_SEARCH_QUERIES = [
  'tiktok shop vietnam',
  'deal hot viet nam',
  'my pham chinh hang',
  'thoi trang nu',
];

// ─── TikTok Shop: chỉ từ khoá thương mại điện tử, tuyệt đối không có nội dung
// giải trí/trend mạng xã hội. Dùng bởi Actor clockworks/tiktok-shop-scraper.
const DEFAULT_SHOP_KEYWORDS = [
  'my pham',
  'skincare',
  'son moi',
  'kem chong nang',
  'thoi trang nu',
  'ao thun',
  'giay dep',
  'tui xach',
  'do gia dung',
  'noi that',
  'thiet bi dien tu',
  'tai nghe',
  'phu kien dien thoai',
  'do cho me va be',
  'thuc pham chuc nang',
];

// Danh mục TikTok Shop VN dùng khi Actor hỗ trợ category URL.
const DEFAULT_SHOP_CATEGORY_URLS = [
  'https://www.tiktok.com/shop/c/beauty-personal-care/601450',
  'https://www.tiktok.com/shop/c/womenswear-underwear/601152',
  'https://www.tiktok.com/shop/c/phones-electronics/601739',
  'https://www.tiktok.com/shop/c/home-supplies/600001',
  'https://www.tiktok.com/shop/c/shoes/601352',
];

// Actor chuyên dụng TikTok Shop HỖ TRỢ THỊ TRƯỜNG VIỆT NAM.
// (clockworks/tiktok-shop-scraper chỉ hỗ trợ US — không dùng cho đồ án VN.)
const DEFAULT_SHOP_ACTOR = 'memo23/tiktok-shop-scraper';

/**
 * TRẦN CỨNG về số sản phẩm mỗi lần chạy.
 * Không cấu hình nào được phép vượt quá giá trị này — bảo vệ ngân sách Apify
 * (30 sản phẩm ≈ $0.39 ở mức $13/1000, luôn thấp hơn rất nhiều so với $5.00).
 */
export const HARD_MAX_ITEMS_PER_RUN = 30;

const databaseUrl = readString('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('Thiếu biến môi trường DATABASE_URL. Hãy cấu hình file .env trước khi khởi động.');
}

export const env = Object.freeze({
  nodeEnv: readString('NODE_ENV', 'development'),
  isProduction: readString('NODE_ENV', 'development') === 'production',
  port: readInt('PORT', 3000),
  databaseUrl,
  timezone: readString('TZ', 'Asia/Ho_Chi_Minh'),

  apify: {
    token: readString('APIFY_TOKEN'),
    actorId: readString('APIFY_TIKTOK_ACTOR', 'clockworks/tiktok-scraper'),
    creativeActor: readString('APIFY_CREATIVE_ACTOR', 'memo23/tiktok-creative-center-scraper'),
    creatorSearchActor: readString('APIFY_CREATOR_SEARCH_ACTOR', 'clockworks/tiktok-user-search-scraper'),
    /** Creator search costs $0.006/profile on the free plan; hard cap per shop run. */
    creatorSearchMaxProfiles: Math.min(10, Math.max(0, readInt('APIFY_CREATOR_SEARCH_MAX_PROFILES', 10))),
    /** Shop $12/1,000 + up to 10 creator profiles at $6/1,000: 11 runs <= $4.62/month. */
    shopMonthlyRunLimit: Math.min(11, Math.max(0, readInt('APIFY_SHOP_MONTHLY_RUN_LIMIT', 11))),
    profiles: readList('APIFY_PROFILES', DEFAULT_TARGET_PROFILES),
    searchQueries: readList('APIFY_SEARCH_QUERIES', DEFAULT_SEARCH_QUERIES),
    resultsPerPage: readInt('APIFY_RESULTS_PER_PAGE', 30),
    timeoutSecs: readInt('APIFY_TIMEOUT_SECS', 900),
    // ─── TikTok Shop Scraping (độc quyền TMĐT) ─────────────────────────────
    /** Actor chuyên dụng cho TikTok Shop */
    shopActorId: readString('APIFY_SHOP_ACTOR', DEFAULT_SHOP_ACTOR),
    /** Từ khoá tìm sản phẩm TikTok Shop */
    shopKeywords: readList('APIFY_SHOP_KEYWORDS', DEFAULT_SHOP_KEYWORDS),
    /**
     * Số sản phẩm mỗi lần chạy — ÉP CỨNG trần HARD_MAX_ITEMS_PER_RUN (30).
     * Dù .env đặt lớn hơn cũng bị cắt về 30.
     */
    shopMaxItemsPerRun: Math.min(
      HARD_MAX_ITEMS_PER_RUN,
      Math.max(1, readInt('APIFY_SHOP_MAX_ITEMS_PER_RUN', HARD_MAX_ITEMS_PER_RUN)),
    ),
    /** Số sản phẩm tối đa mỗi từ khoá (được suy ra từ budget, không vượt trần) */
    shopProductsPerSearch: Math.min(
      HARD_MAX_ITEMS_PER_RUN,
      Math.max(1, readInt('APIFY_SHOP_PRODUCTS_PER_SEARCH', HARD_MAX_ITEMS_PER_RUN)),
    ),
    /** Số từ khoá tối đa gộp vào 1 lần gọi Actor (1 batch = 1 Actor run = chi phí thấp nhất) */
    shopKeywordsPerRun: Math.max(1, readInt('APIFY_SHOP_KEYWORDS_PER_RUN', 15)),
    /** Region của Actor TikTok Shop — mặc định VN theo phạm vi đồ án */
    shopRegion: readString('APIFY_SHOP_REGION', 'VN').toUpperCase(),
    /**
     * Chấp nhận item không xác định được thị trường (không có currency VND
     * hoặc URL /vn/). Mặc định false: chỉ lưu dữ liệu chắc chắn thuộc VN.
     */
    shopAllowUnknownMarket: readBoolean('APIFY_SHOP_ALLOW_UNKNOWN_MARKET', false),
    /** URL danh mục TikTok Shop (nếu Actor hỗ trợ) */
    shopCategoryUrls: readList('APIFY_SHOP_CATEGORY_URLS', DEFAULT_SHOP_CATEGORY_URLS),
    /**
     * Lấy thêm bảng xếp hạng best-sellers của thị trường VN (memo23).
     * Cùng 1 Actor run nên KHÔNG phát sinh thêm chi phí Actor.
     */
    shopIncludeBestSellers: readBoolean('APIFY_SHOP_INCLUDE_BEST_SELLERS', true),
    /** Số best-seller lấy thêm mỗi lần chạy (20/trang). */
    shopBestSellersCount: Math.min(60, Math.max(0, readInt('APIFY_SHOP_BEST_SELLERS_COUNT', 20))),
    /**
     * Đọc chi tiết từng sản phẩm (SKU/tồn kho). Với VN, Actor chỉ trả listing
     * row nên mặc định tắt để tiết kiệm thời gian; bật nếu Actor hỗ trợ.
     */
    shopIncludeDetails: readBoolean('APIFY_SHOP_INCLUDE_DETAILS', false),
    /**
     * Số video xu hướng tối đa gắn với sản phẩm/shop mỗi chu kỳ.
     *
     * LƯU Ý CHI PHÍ: đây là một Actor run RIÊNG (tốn credit ngoài ngân sách 30
     * sản phẩm). Mặc định 0 = TẮT để giữ chi phí ở mức tối thiểu tuyệt đối.
     * Bật bằng APIFY_SHOP_TREND_VIDEOS_PER_RUN, tối đa 10.
     */
    shopTrendVideosPerRun: Math.min(10, Math.max(0, readInt('APIFY_SHOP_TREND_VIDEOS_PER_RUN', 0))),
    // ─── Profile Scraping config ───────────────────────────────────────────
    /** Số item tối đa mỗi profile khi cào theo Targeted Shops */
    profileResultsPerPage: readInt('APIFY_PROFILE_RESULTS_PER_PAGE', 50),
    /** Số lượng profile tối đa đưa vào 1 lần gọi Apify */
    maxProfilesPerRun: readInt('APIFY_MAX_PROFILES_PER_RUN', 50),
    /** Bật cào bổ sung Creative Center (creators/products/videos) */
    creativeEnabled: readBoolean('APIFY_CREATIVE_ENABLED', false),
    // ─── Retry / chống chặn ────────────────────────────────────────────────
    /** Số lần thử tối đa khi Apify lỗi mạng / trả về rỗng (mặc định 3) */
    maxAttempts: Math.max(1, readInt('APIFY_MAX_ATTEMPTS', 3)),
    /** Thời gian chờ tối thiểu giữa 2 lần thử (ms) */
    retryDelayMinMs: Math.max(0, readInt('APIFY_RETRY_DELAY_MIN_MS', 5000)),
    /** Thời gian chờ tối đa giữa 2 lần thử (ms) */
    retryDelayMaxMs: Math.max(0, readInt('APIFY_RETRY_DELAY_MAX_MS', 10000)),
  },

  scrape: {
    cron: readString('SCRAPE_CRON', '0 0 * * *'),
    enabled: readBoolean('SCRAPE_SCHEDULER_ENABLED', true),
    runOnStartup: readBoolean('SCRAPE_ON_STARTUP', false),
    fallbackEnabled: readBoolean('SCRAPE_PLAYWRIGHT_FALLBACK', true),
    playwrightHeadless: readBoolean('PLAYWRIGHT_HEADLESS', true),
    concurrency: readInt('SCRAPE_CONCURRENCY', 5),
    /** Chỉ cào dữ liệu TikTok Shop, bỏ toàn bộ nguồn mạng xã hội. */
    // Enforced for this deliverable: prevent legacy social/video scraping paths.
    shopOnly: true,
    /** Lịch cào TikTok Shop mặc định mỗi 12 giờ */
    shopCron: readString('SCRAPE_SHOP_CRON', '0 */12 * * *'),
    shopRunOnStartup: readBoolean('SCRAPE_SHOP_ON_STARTUP', false),
    /** Bắt đầu vòng lặp `npm run scrape` ngay sau khi server khởi động */
    autoStartLoop: readBoolean('SCRAPE_AUTO_START_LOOP', false),
    /**
     * Thời gian (ms) trước khi file lock `.scrape.lock` bị coi là rác do crash.
     * Mặc định 2 giờ — đủ dài cho 1 phiên cào + retry.
     */
    lockStaleMs: Math.max(60_000, readInt('SCRAPE_LOCK_STALE_MS', 2 * 60 * 60 * 1000)),
    // ─── Profile Scraping Scheduler ───────────────────────────────────────────────
    profileCron: readString('SCRAPE_PROFILE_CRON', '0 */6 * * *'),
    profileRunOnStartup: readBoolean('SCRAPE_PROFILE_ON_STARTUP', false),
    /** Lịch cào Creative Center (mặc định 03:00 mỗi ngày) */
    creativeCron: readString('SCRAPE_CREATIVE_CRON', '0 3 * * *'),
  },

  echotik: {
    /** Bật/tắt EchoTik integration */
    enabled: readBoolean('ECHOTIK_ENABLED', false),
    /** Basic Auth username */
    username: readString('ECHOTIK_USERNAME'),
    /** Basic Auth password */
    password: readString('ECHOTIK_PASSWORD'),
    /** Base URL của EchoTik API */
    baseUrl: readString('ECHOTIK_BASE_URL', 'https://api.echotik.com'),
    /** Region (VN, SG, TH, etc.) */
    region: readString('ECHOTIK_REGION', 'VN').toUpperCase(),
    /** Language (vi-VN, en-US, etc.) */
    language: readString('ECHOTIK_LANGUAGE', 'vi-VN'),
    /** Giới hạn requests/tháng */
    maxRequestsPerMonth: Math.max(1, readInt('ECHOTIK_MAX_REQUESTS_PER_MONTH', 50)),
    /** Verified requests already consumed according to the provider dashboard; -1 means unverified. */
    quotaReconciledUsed: readInt('ECHOTIK_QUOTA_RECONCILED_USED', -1),
    /** Timeout cho HTTP request tới EchoTik (ms) */
    timeoutMs: Math.max(5000, readInt('ECHOTIK_TIMEOUT', 30000)),
    /** Số lần retry khi lỗi */
    maxAttempts: Math.max(1, readInt('ECHOTIK_MAX_ATTEMPTS', 3)),
    /** Thời gian chờ tối thiểu giữa 2 lần retry (ms) */
    retryDelayMinMs: Math.max(0, readInt('ECHOTIK_RETRY_DELAY_MIN_MS', 2000)),
    /** Thời gian chờ tối đa giữa 2 lần retry (ms) */
    retryDelayMaxMs: Math.max(0, readInt('ECHOTIK_RETRY_DELAY_MAX_MS', 5000)),
  },

  logLevel: readString('LOG_LEVEL', 'info').toLowerCase(),
  adminToken: readString('ADMIN_TOKEN'),
  ai: {
    provider: readString('AI_PROVIDER', 'google').toLowerCase(),
    model: readString('AI_MODEL', readString('GEMINI_MODEL', 'gemini-2.0-flash')),
  },
  openrouter: {
    apiKey: readString('OPENROUTER_API_KEY'),
    baseUrl: readString('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1/chat/completions'),
  },
  gemini: {
    enabled: readBoolean('GEMINI_ENABLED', true),
    apiKey: readString('GEMINI_API_KEY'),
    model: readString('GEMINI_MODEL', 'gemini-2.0-flash'),
    baseUrl: readString('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    timeoutMs: Math.max(10_000, readInt('GEMINI_TIMEOUT_MS', 60_000)),
    maxAttempts: Math.max(1, Math.min(3, readInt('GEMINI_MAX_ATTEMPTS', 2))),
    retryDelayMs: Math.max(250, Math.min(10_000, readInt('GEMINI_RETRY_DELAY_MS', 1_000))),
    maxInputChars: Math.max(10_000, readInt('GEMINI_MAX_INPUT_CHARS', 120_000)),
    maxOutputTokens: Math.max(256, readInt('GEMINI_MAX_OUTPUT_TOKENS', 8_192)),
    maxAnalysesPerProduct: Math.max(1, readInt('GEMINI_MAX_ANALYSES_PER_PRODUCT', 3)),
    maxAnalysesPerDay: Math.max(1, readInt('GEMINI_MAX_ANALYSES_PER_DAY', 100)),
    inputPricePerMillionTokens: Math.max(0, readInt('GEMINI_INPUT_PRICE_PER_MILLION', 0)),
    outputPricePerMillionTokens: Math.max(0, readInt('GEMINI_OUTPUT_PRICE_PER_MILLION', 0)),
  },
});

export type AppEnv = typeof env;

export const isEchoTikEnabled = () =>
  env.echotik.enabled && !!env.echotik.username && !!env.echotik.password;
