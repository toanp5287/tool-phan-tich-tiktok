# TIKTOK ANALYTICS SYSTEM - PHASE 1 AUDIT REPORT
**Date:** 2026-11-06  
**Status:** Analysis Complete - Ready for Implementation Plan  
**Scope:** Backend-only API server with real EchoTik data in PostgreSQL

---

## EXECUTIVE SUMMARY

This is an **Express.js + Prisma + PostgreSQL** backend API system designed to serve TikTok e-commerce analytics data. The architecture is:
- **NO FRONTEND** currently exists (no React/Vue/HTML pages)
- **43 API endpoints** implemented in Express routes
- **16 Prisma models** with snapshot-based historical tracking
- **2 EchoTik data files** imported (587 records = 10 shops)
- **16 database migrations** completed
- **Real data** from EchoTik already in PostgreSQL

---

## PART 1: PROJECT STRUCTURE

### Technology Stack
```
Runtime:    Node.js 20+
Framework:  Express 5.3.0
ORM:        Prisma 7.10.1
Database:   PostgreSQL (via @prisma/adapter-pg)
Language:   TypeScript 7.0.2
Build:      tsc (TypeScript compiler)
```

### Directory Layout
```
D:\tiktok-scraper-ts/
├── src/
│   ├── app.ts                      # Express app setup
│   ├── server.ts                   # Server entry point
│   ├── config/
│   │   └── db.ts                   # Prisma client
│   ├── routes/
│   │   ├── apiRoutes.ts           # Main 43 API endpoints
│   │   ├── trendRoute.ts          # Trend endpoints
│   │   └── priceSegmentRoute.ts   # Price analysis
│   ├── controllers/ (9 files)
│   │   ├── analyticsController.ts  # Dashboard, products, shops
│   │   ├── creatorController.ts    # Creators & affiliates
│   │   ├── echoTikController.ts    # EchoTik sync
│   │   ├── hierarchyController.ts  # Categories
│   │   ├── shopScrapeController.ts # Shop metrics
│   │   └── 4 more...
│   ├── services/ (45 files)
│   │   ├── analyticsService.ts
│   │   ├── productService.ts       # ← Product queries
│   │   ├── shopService.ts          # ← Shop queries
│   │   ├── creatorService.ts       # ← Creator queries
│   │   ├── dashboardService.ts     # ← Dashboard aggregates
│   │   ├── echotik/ (13 files)     # EchoTik sync pipeline
│   │   ├── scraper/ (13 files)     # Apify scraper (optional)
│   │   └── shopCommerce/ (10 files) # Commerce module (alternative)
│   ├── scripts/ (10 files)
│   │   ├── syncEchoTikFullDataset.ts  # ← Main sync script
│   │   ├── syncEchoTikShops.ts
│   │   ├── backfillCategories.ts
│   │   └── 7 more...
│   ├── types/
│   ├── utils/
│   └── modules/shopCommerce/       # Alternative API namespace
├── prisma/
│   ├── schema.prisma               # 16 models, 688 lines
│   └── migrations/ (16 total)
├── data/
│   ├── echotik/
│   │   ├── seller-list-2026-11-05T19-40-47-301Z.json
│   │   └── seller-list-2026-11-05T19-41-35-084Z.json
│   └── tiktok-trends-2026-10-31.json
├── public/                         # NO HTML/frontend files
├── package.json
├── tsconfig.json
└── .env                           # Database URL, EchoTik credentials
```

---

## PART 2: DATABASE STATUS

### Schema Overview
**File:** `prisma/schema.prisma` (688 lines)

#### Core Models (16 total)

| Model | Purpose | Records Est. | Primary Key | Snapshots? |
|-------|---------|--------------|-------------|-----------|
| **Shop** | TikTok shops/sellers | ~50 | platformShopId (unique) | ShopRevenueSnapshot |
| **Product** | E-commerce products | ~1000 | platformProductId + source | ProductSnapshot |
| **Creator** | Content creators/affiliates | ~500 | platformCreatorId + source | CreatorSnapshot |
| **Category** | Category hierarchy L1 | ~50 | name (unique) | CategorySnapshot |
| **SubCategory** | Category L2 | ~200 | categoryId + name | None |
| **ThirdLevelCategory** | Category L3 | ~500 | subCategoryId + name | None |
| **TrendItem** | Trending videos | ~1000 | platformVideoId | None |
| **ProductVariant** | SKU/variants per product | ~10000 | productId + platformSkuId | None |
| **ProductShop** | Product-shop linking | ~10000 | productId + shopId | ShopProductSnapshot |
| **ProductCreator** | Product-creator affiliate links | ~10000 | productId + creatorId | None |
| **CreatorShop** | Creator-shop links | ~1000 | creatorId + shopId | None |
| **TargetedShop** | Admin target profiles | ~20 | username (unique) | None |
| **ScrapeJob** | Job tracking | ~100 | id | None |
| **EchoTikQuotaLog** | Quota tracking | ~12 | month (unique) | None |

**Snapshot Tables (4 total)** - Store daily metrics for trend analysis:
- `ProductSnapshot` - Daily sales, GMV, ratings per product
- `ShopRevenueSnapshot` - Daily revenue breakdown (Video/Live/Cart/ProductCard) per shop
- `ShopProductSnapshot` - Daily metrics per shop-product pair
- `CreatorSnapshot` - Daily follower/engagement/GMV per creator
- `CategorySnapshot` - Daily category-level market metrics

### Current Data

**EchoTik Import Status:**
```
Files:     2 JSON files (seller lists)
Records:   587 total seller records
Shops:     10 unique shops (all skipped due to existing platformShopId)
Status:    { received: 10, created: 0, updated: 0, skipped: 10, failed: 0 }
```

**The 10 Shops (already in DB):**
1. Hải Anh Lee (followers: 0, GMV: ₫9.27)
2. Nhung Silk Lụa (followers: 8,343, GMV: ₫1,563.39)
3. Khoá Cửa Tay Nắm (followers: 0, GMV: ₫0)
4. Gia Dụng Như Hoàng (followers: 0, GMV: ₫987.63)
5. RealMen09xx (followers: 0, GMV: ₫77.64)
6. Anxinji (followers: 954, GMV: ₫1,106,427.86) ← Top seller
7. Yến Sào Cam Lâm (followers: 0, GMV: ₫0)
8. Công Nghệ Xây Dựng HYM (followers: 0, GMV: ₫21.96)
9. Lượm Nguyễn (followers: 7,966, GMV: ₫3,263.06)
10. Cẩm Quyên-Dầu Gội (followers: 1,877, GMV: ₫4,426.87)

**Migrations Applied:** 16 migrations (baseline through 2026-11-05)

---

## PART 3: API ENDPOINT INVENTORY (43 TOTAL)

### Route Files

| File | Endpoints | Purpose |
|------|-----------|---------|
| `apiRoutes.ts` | 41 | Main router (dashboard, products, shops, creators, categories, scrape, echotik) |
| `trendRoute.ts` | 1 | Trends endpoint |
| `priceSegmentRoute.ts` | 1 | Price segment analysis |

### Endpoint Listing

#### Dashboard & Overview (8 endpoints)
```
GET  /api/overview              → getDashboardOverview()
GET  /api/analytics             → (alias)
GET  /api/analytics/trends      → getTrendSummary()
GET  /api/trends                → listTrendItems()
GET  /api/trends/keywords       → getKeywordInsights()
GET  /api/jobs                  → listScrapeJobs()
GET  /api/jobs/:id              → getScrapeJob()
```

#### Products (3 endpoints)
```
GET  /api/products              → listProducts() + filters + sorting
GET  /api/products/:id          → getProductDetail()
GET  /api/products/compare      → compareProducts()
```

#### Shops (3 endpoints)
```
GET  /api/shops                 → listShops()
GET  /api/shops/:id             → getShopDetail()
GET  /api/shops/:id/videos      → getVideosByShop()
```

#### Categories (4 endpoints)
```
GET  /api/categories            → getCategories()
GET  /api/categories/:cat       → getCategory()
GET  /api/categories/:cat/sub   → getSubCategory()
POST /api/categories/sync       → syncCategories()
```

#### Creators (4 endpoints)
```
GET  /api/creators              → getCreators()
GET  /api/creators/top          → getTopCreatorsList()
GET  /api/creators/:id          → getCreatorById()
POST /api/creators/scrape       → triggerCreativeScrape()
```

#### Targeted Shops CRUD (6 endpoints)
```
GET  /api/targets               → getTargetedShops()
POST /api/targets               → createTarget()
GET  /api/targets/:id           → getTargetedShop()
PATCH /api/targets/:id          → updateTarget()
PATCH /api/targets/:id/toggle   → toggleTarget()
DELETE /api/targets/:id         → deleteTarget()
```

#### Scrape Operations (6 endpoints)
```
GET  /api/scrape/status         → getScrapeStatus()
POST /api/scrape                → triggerScrape()
POST /api/scrape/run-top-shops  → triggerTopShopScrape()
GET  /api/scrape/profile-status → getProfileScrapeStatus()
POST /api/scrape/tiktok-shop    → triggerShopScrape()
GET  /api/scrape/tiktok-shop/status → getShopScrapeStatus()
```

#### Growth Analysis (2 endpoints)
```
GET  /api/growth/products/:id   → getProductGrowthById()
GET  /api/growth/shops/:id      → getShopGrowthById()
```

#### EchoTik Admin (3 endpoints)
```
GET  /api/admin/echotik/quota   → getEchoTikQuota()
GET  /api/admin/echotik/status  → getEchoTikSyncStatus()
POST /api/admin/echotik/sync    → triggerEchoTikSync()
```

#### Commerce Module (Alternative, 7 endpoints)
```
GET  /api/commerce/overview
GET  /api/commerce/products
GET  /api/commerce/shops
GET  /api/commerce/creators
GET  /api/commerce/categories
GET  /api/commerce/trend-videos
```

---

## PART 4: CONTROLLER & SERVICE LAYER

### Controllers (9 files)

| File | Functions | Purpose |
|------|-----------|---------|
| `analyticsController.ts` | getProducts, getShops, getOverview, getTrends, getKeywords | Main dashboard queries |
| `creatorController.ts` | getCreators, getCreatorById, getTopCreatorsList, triggerCreativeScrape | Creator endpoints |
| `echoTikController.ts` | getEchoTikQuota, getEchoTikSyncStatus, triggerEchoTikSync | EchoTik admin |
| `hierarchyController.ts` | getCategories, getCategory, getSubCategory, syncCategories, getVideosByShop | Category endpoints |
| `priceSegmentController.ts` | (analysis endpoints) | Price distribution |
| `scrapeController.ts` | triggerScrape, getScrapeStatus, getScrapeJob | Scrape trigger |
| `shopScrapeController.ts` | triggerShopScrape, getShopScrapeStatus, getProductGrowthById, getShopGrowthById | Shop-specific scrape |
| `targetedShopController.ts` | CRUD for targeted shops | Admin shop management |
| `trendController.ts` | (trend endpoints) | Trend analysis |

### Key Services (19 core files)

| File | Key Functions | Data Source |
|------|---------------|-------------|
| `productService.ts` | listProducts(), getProductDetail(), compareProducts() | PostgreSQL via Prisma |
| `shopService.ts` | listShops(), getShopDetail(), getKeywordInsights() | PostgreSQL via Prisma |
| `creatorService.ts` | getCreators(), getCreatorById(), getShopAffiliates() | PostgreSQL via Prisma |
| `dashboardService.ts` | getDashboardOverview(), getTrendSummary(), listScrapeJobs() | PostgreSQL aggregates |
| `analyticsService.ts` | Aggregation & calculations | Snapshots |
| `categoryCatalogService.ts` | Category hierarchy | PostgreSQL |
| `growthService.ts` | buildGrowthFromSnapshot() | ProductSnapshot deltas |
| `priceSegmentService.ts` | Price distribution analysis | ProductVariant |
| `sourcePriorityService.ts` | getPreferredSnapshot() | Source priority logic |
| `trendService.ts` | Trending item analysis | TrendItem |
| `jobService.ts` | Job queue management | ScrapeJob |
| `hierarchyService.ts` | Category tree construction | Category models |
| `targetedShopService.ts` | CRUD for targeted shops | TargetedShop |

### EchoTik Sync Pipeline (13 files in `services/echotik/`)

| File | Purpose | Status |
|------|---------|--------|
| `echoTikClient.ts` | REST client (5 endpoints) | ✅ Implemented |
| `echoTikShopIngestionService.ts` | Shop ingestion (upsert logic) | ⚠️ Skips duplicates |
| `echoTikProductFullIngestionService.ts` | Product ingestion | ✅ Implemented |
| `echoTikCategoryIngestionService.ts` | Category ingestion | ✅ Implemented |
| `echoTikFullSyncOrchestrator.ts` | Main orchestration | ✅ Implemented |
| `echoTikNormalizer.ts` | Field mapping | ✅ Implemented |
| `echoTikQuotaService.ts` | Quota tracking | ✅ Implemented |
| `echoTikAuthVerifier.ts` | Auth check | ✅ Implemented |
| `echoTikApiTester.ts` | Testing utility | ✅ Implemented |
| `echoTikSyncService.ts` | Sync orchestration | ✅ Implemented |
| `echoTikSyncFixes.test.ts` | Tests (requires Jest) | ❌ Type errors |
| + 2 more variants | Alternative sync strategies | ✅ Implemented |

---

## PART 5: DATA AVAILABILITY MATRIX

### ✅ FULLY AVAILABLE (from EchoTik)

**Shop Data:**
- platformShopId (seller_id)
- name (seller_name)
- followerCount (followers_count)
- ratingScore (rating)
- ratingCount (review_count)
- productCount (total_crawl_product_cnt)
- shopUrl (seller_link)
- bannerUrl (cover_url)
- totalGmvAmt (total_sale_gmv_amt)
- totalSaleCount (total_sale_cnt)

**Product Data:**
- platformProductId (product_id)
- title
- price range (min_price, max_price)
- category (category_id)
- spu_avg_price

**Category Data:**
- category_id, category_l2_id, category_l3_id
- name, parent_id, level

### ⚠️ PARTIALLY AVAILABLE (Estimated or Calculated)

- **Product GMV** - Calculated from price × sold_count (not direct)
- **Shop GMV daily breakdown** - Marked `isEstimated=true`, breakdown unknown
- **Revenue sources** - Video/Live/Cart/ProductCard breakdown not from EchoTik
- **Growth rates** - Calculated from snapshot deltas
- **Creator engagement rate** - Calculated, not from API

### ❌ NOT AVAILABLE (Missing from EchoTik)

| Data | Why Missing | Alternative |
|------|------------|-------------|
| Video engagement (playCount, diggCount, etc.) | EchoTik returns NULL | Apify scraper TrendItem |
| Creator/Affiliate data | No EchoTik endpoint exists | Apify scraper Creator |
| Product images (imageUrl) | EchoTik doesn't provide | Apify scraper or manual |
| Shop avatar URL (avatarUrl) | EchoTik doesn't provide | Manual or Apify |
| Individual product sales per shop | Only shop-level aggregates | Must compute from ProductShop |
| Affiliate commission rates | Not provided | Manual data entry |

---

## PART 6: BUILD & TEST STATUS

### TypeScript Compilation

**Current Status:** 1 error (non-blocking)
```
echoTikSyncFixes.test.ts(6,50): error TS2307: Cannot find module '@jest/globals'
```
**Impact:** Test file has missing Jest types (optional for production)

### npm Scripts Available

| Script | Purpose | Status |
|--------|---------|--------|
| `npm run dev` | Watch mode (tsc --watch) | ✅ Ready |
| `npm run build` | Compile TypeScript | ✅ Ready |
| `npm run start` | Run compiled server | ✅ Ready |
| `npm run typecheck` | Type checking only | ⚠️ 1 test error |
| `npm run db:generate` | Generate Prisma client | ✅ Ready |
| `npm run db:migrate` | Apply migrations | ✅ Ready |
| `npm run db:studio` | Prisma Studio UI | ✅ Ready |
| `npm run echotik:sync-shops` | Sync EchoTik shops | ✅ Implemented |
| `npm run echotik:sync-full` | Full EchoTik sync | ✅ Implemented |
| `npm run scrape:once` | One-time Apify scrape | ✅ Implemented |

---

## PART 7: CRITICAL FINDINGS

### Issue 1: Shop Import Skipped All 10 Records
**Root Cause:** `platformShopId` has `@unique` global constraint  
**Current Logic:** If shop exists → skip  
**Impact:** All 10 EchoTik shops were already in DB, so 0 updates  
**Recommendation:** Implement UPSERT to update existing shops with new EchoTik data

### Issue 2: No Frontend
**Status:** Backend API only (no React/Vue/HTML pages)  
**Impact:** Cannot serve UI from Express  
**Recommendation:** Build separate frontend or serve static files from `public/`

### Issue 3: Video Engagement Data Missing
**Status:** TrendItem fields (playCount, diggCount, etc.) are NULL from EchoTik  
**Source:** EchoTik API doesn't return video engagement  
**Workaround:** Data only available from Apify scraper

### Issue 4: Creator/Affiliate Data Not from EchoTik
**Status:** No EchoTik endpoint for creators  
**Source:** Creator data only from Apify scraper  
**Impact:** Creators.html page cannot show EchoTik-sourced creator data

### Issue 5: Jest Type Errors in Test File
**File:** `echoTikSyncFixes.test.ts`  
**Status:** Non-blocking (optional test file)  
**Fix:** Add `@types/jest` or remove test file

---

## PART 8: DATA FLOW ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────┐
│ EXTERNAL DATA SOURCES                                           │
├─────────────────────────────────────────────────────────────────┤
│  EchoTik API          │  Apify Scraper  │  Manual Data Entry    │
│  (5 endpoints)        │  (optional)     │  (TargetedShop)       │
│  • Seller/Shop List   │  • Shop profiles│  • Targets            │
│  • Product List       │  • Products     │                       │
│  • Categories         │  • Creators     │                       │
│  • Product Trend      │  • Trend videos │                       │
└──────┬────────────────┴─────────┬───────┴──────────┬────────────┘
       │                          │                  │
       ▼                          ▼                  ▼
┌──────────────────────────────────────────────────────────────────┐
│ SYNC SCRIPTS (src/scripts/)                                      │
├──────────────────────────────────────────────────────────────────┤
│  syncEchoTikFullDataset.ts      │  scrapeContinuous.ts          │
│  • Fetches from EchoTik         │  • Fetches from Apify         │
│  • Normalizes fields            │  • Ingests records            │
│  • Tracks quota usage           │  • Updates snapshots          │
└──────┬───────────────────────────┴──────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ INGESTION LAYER (src/services/)                                  │
├──────────────────────────────────────────────────────────────────┤
│  echoTikShopIngestionService.ts                                  │
│  echoTikProductFullIngestionService.ts                          │
│  echoTikCategoryIngestionService.ts                             │
│  • Upsert Shop, Product, Creator records                         │
│  • Create snapshots                                              │
│  • Handle deduplication                                          │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL DATABASE (via Prisma 7.10.1)                          │
├──────────────────────────────────────────────────────────────────┤
│  • Shop (10 records from EchoTik)                                │
│  • Product (1000s)                                               │
│  • Creator (500s)                                                │
│  • ProductSnapshot, ShopRevenueSnapshot, etc. (history)         │
│  • TargetedShop (admin targets)                                 │
│  • ScrapeJob (job queue)                                         │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ EXPRESS API LAYER (src/routes/ + src/controllers/)              │
├──────────────────────────────────────────────────────────────────┤
│  43 Endpoints (GET/POST/PATCH/DELETE)                           │
│  • /api/products, /api/shops, /api/creators, /api/categories    │
│  • /api/trends, /api/growth, /api/scrape, /api/admin/echotik   │
│  • /api/targets, /api/jobs                                      │
│                                                                  │
│  Service Layer (productService.ts, shopService.ts, etc.)        │
│  • Query Prisma with filters & sorting                           │
│  • Aggregate snapshots for trends                                │
│  • Calculate growth rates & rankings                             │
└──────┬───────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ FRONTEND (NOT YET IMPLEMENTED)                                   │
├──────────────────────────────────────────────────────────────────┤
│  Need to build:                                                  │
│  • Dashboard (shop.html)                                         │
│  • Shop List & Detail (shops.html, shop-detail.html)            │
│  • Product List & Detail (products.html, detail.html)           │
│  • Creator List & Detail (creators.html, creator.html)          │
│  • Category Pages (categories.html, subcategory.html)           │
│  • Trends Page (trends.html)                                     │
│  • Admin Pages (targets.html, jobs.html)                        │
│                                                                  │
│  Technologies: React/Vue.js 3 + Chart.js + Tailwind CSS         │
└──────────────────────────────────────────────────────────────────┘
```

---

## PART 9: WHAT'S WORKING

✅ **Backend API Infrastructure:**
- Express server running on port 3000 (likely)
- 43 REST endpoints defined in routes
- Prisma client connected to PostgreSQL
- Request handlers with error handling

✅ **Database:**
- 16 migrations applied
- 16 Prisma models defined
- 10 shops already imported from EchoTik
- Snapshot tables ready for history tracking

✅ **EchoTik Integration:**
- API client implemented (echoTikClient.ts)
- 5 endpoints verified working
- Quota tracking in place
- Full sync orchestrator ready
- Normalizer for field mapping ready

✅ **Service Layer:**
- productService.ts has filters, sorting, pagination
- shopService.ts has shop list + detail
- creatorService.ts has creator queries
- dashboardService.ts has overview aggregates
- growthService.ts computes trends
- Source priority logic implemented

---

## PART 10: WHAT'S MISSING

❌ **Frontend:**
- No HTML/React/Vue pages
- No UI components
- No charts or visualizations
- No user interface at all

❌ **Production Ready:**
- No authentication/authorization
- No rate limiting
- No request validation middleware
- No logging/monitoring
- No CI/CD pipeline

❌ **Data Completeness:**
- Creator data only from Apify (no EchoTik endpoint)
- Video engagement (playCount, diggCount) not available
- Product images not from EchoTik
- Some fields marked "estimated" without verification

---

## PART 11: NEXT STEPS (PROPOSED PHASES)

### Phase 1: Data Sync Completion ✅ ANALYSIS DONE
- [x] Audit database schema
- [x] Verify EchoTik data files
- [x] Check ingestion logic
- [ ] **Fix shop ingestion to UPSERT instead of skip**
- [ ] Verify all 10 shops updated with latest EchoTik data
- [ ] Check product counts & categories

### Phase 2: Backend API Verification 🔄 NEXT
- [ ] Run `npm run build` - verify TypeScript compiles
- [ ] Start server - `npm run start`
- [ ] Test all 43 endpoints with curl/Postman
- [ ] Verify pagination works (shops, products)
- [ ] Verify sorting works (by GMV, sales, etc.)
- [ ] Verify filtering works (category, region, etc.)
- [ ] Check error handling for bad inputs

### Phase 3: Frontend Development 🔄 CRITICAL
- [ ] Create React/Vue project or use Express `public/` folder
- [ ] Build Dashboard page (overview, top 3 shops, products, creators)
- [ ] Build Shop List page (paginated, sortable)
- [ ] Build Product List page (paginated, searchable)
- [ ] Build Creator List page
- [ ] Build Category pages
- [ ] Build Detail pages (shop, product, creator)
- [ ] Connect to backend APIs
- [ ] Add charts (Chart.js or Recharts)
- [ ] Add loading/error states
- [ ] Test data display vs. backend

### Phase 4: Polish & Testing 🔄 FINAL
- [ ] Full end-to-end testing
- [ ] Performance optimization
- [ ] Mobile responsiveness
- [ ] Accessibility review
- [ ] Documentation

---

## PART 12: TECHNICAL DEBT & BLOCKERS

| Item | Severity | Recommendation |
|------|----------|-----------------|
| No frontend UI | 🔴 CRITICAL | Build React/Vue pages or serve from public/ |
| Shop ingestion skips duplicates | 🟠 HIGH | Change skip logic to UPSERT |
| Jest types missing | 🟡 LOW | Add @types/jest or delete test file |
| Creator data not from EchoTik | 🟠 MEDIUM | Document limitation or add Apify fallback |
| Video engagement missing | 🟠 MEDIUM | Use Apify data or mark NULL in UI |
| No authentication | 🟠 HIGH | Add JWT/sessions if needed |
| Quota tracking only in code | 🟡 MEDIUM | Add UI to display quota status |

---

## SUMMARY

**Project State:** Backend API complete, database populated, frontend missing.

**Data Sources:**
- ✅ EchoTik: 10 shops, 50 req/month quota (4 used per sync = ~12 syncs available)
- ✅ Apify: Optional scraper for products, creators, trends (currently disabled)
- ✅ PostgreSQL: 16 models, real data, snapshots ready

**Ready to Build:** Frontend pages to consume the 43 working API endpoints.

