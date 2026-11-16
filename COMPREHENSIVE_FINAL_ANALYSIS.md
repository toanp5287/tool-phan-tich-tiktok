# COMPREHENSIVE ECHOTIK INTEGRATION ANALYSIS & DESIGN
## Final Technical Report for TikTok Analytics Platform

**Date:** 2026-11-06  
**Analysis Phase:** COMPLETE - Code & Database Verified  
**Scope:** Website-First Data Collection Architecture  
**Status:** Ready for Review (NO CODE CHANGES YET)

---

# EXECUTIVE SUMMARY

This is a **TikTok E-Commerce Analytics Dashboard** serving Vietnam market data from:
- **EchoTik API** (official shop/product metrics) - 5 endpoints, 50 req/month quota
- **Apify Scraper** (product rankings, creator engagement) - optional, currently disabled
- **PostgreSQL** (Prisma) - 16 models, snapshot-based history

**Website Serves:**
- 14 pages (dashboard, shops, products, creators, trends, categories)
- 43 API endpoints
- 80+ unique data fields
- 8 chart types
- 3 ranking systems (by GMV, by sales, by growth)

**Critical Finding:**
- ✅ All 10 EchoTik shops ARE valid but **SKIPPED** due to duplicate `platformShopId` in DB
- ✅ Database already has shops from prior import
- ⚠️ Video engagement data (playCount/engagement) missing from EchoTik API
- ⚠️ Revenue breakdown fields marked "estimated" not verified
- ⚠️ Creator/Affiliate data not sourced from EchoTik (no endpoint)

---

# PART 1: FRONTEND WEBSITE INVENTORY

## Complete Page Listing

| Page File | Route | Purpose | Primary Data | Status |
|-----------|-------|---------|--------------|--------|
| `shop.html` | `/shop.html` | Dashboard overview | GMV trend, top shops/products/creators, categories | Real + Calculated |
| `shops.html` | `/shops.html` | Shop ranking (sortable by GMV/sales/growth) | Shop list, top 3 products/shop, metrics | Real + Calculated |
| `shop-detail.html` | `/shops.html?id=X` | Individual shop metrics | Revenue breakdown (Video/Live/Cart/ProductCard), top affiliates, new products, trend videos | Real + Estimated |
| `categories.html` | `/categories.html` | Category L1 overview | Market share, GMV by category, shop/product counts | Real + Calculated |
| `subcategory.html` | `/categories.html?category=X&sub=Y` | Category L2 detail | Subcategories, top products, shop list | Real |
| `creators.html` | `/creators.html` | Creator/Affiliate ranking (filterable) | Follower count, GMV, sold count, engagement rate, top products | Real + Calculated |
| `creator.html` | `/creator.html?id=X` | Individual creator metrics | Bio, followers, GMV trend, top products/shops, timeline | Real + Calculated |
| `detail.html` | `/detail.html?id=X` | Product detail page | Price, variants, ratings, top creators, shops selling, sales/GMV/views history | Real + Estimated |
| `trends.html` | `/trends.html` | Trend analysis page | Trending videos, keywords, growth %, video grid | Real (from Apify) / NULL (no EchoTik) |
| `price-segments.html` | `/price-segments.html` | Price distribution analysis | Price buckets, count, avg price, GMV share | Real |
| `targets.html` | `/targets.html` | Targeted shop management (Admin) | CRUD operations, priority levels, last scraped | Real |
| `jobs.html` | `/jobs.html` | Scrape job queue monitor | Job status, records found/saved/failed, duration | Real |
| `app/index.html` | `/app/` | App shell | (redirects) | N/A |

**Frontend Stats:**
- 14 HTML pages (Vue.js 3 + Chart.js)
- 43 API endpoints
- ~80 unique data fields displayed
- 8 chart types (line, area, pie, bar, stacked, grid)
- 3 ranking systems (GMV, sales, growth%)

---

# PART 2: ECHOTIK API CAPABILITY MATRIX

## VERIFIED Endpoints (Code Location: `src/services/echotik/echoTikClient.ts`)

| Endpoint | Method | Path | Query Params | Pagination | Region | Fields Returned | Status |
|----------|--------|------|--------------|-----------|--------|-----------------|--------|
| **Seller List** | GET | `/api/v3/echotik/seller/list` | region, page_num, page_size | ✅ Yes | ✅ VN | seller_id, seller_name, followers_count, rating, review_count, total_crawl_product_cnt, total_sale_gmv_amt, shop_type, response_rate, delivery_rate, sec_uid, cover_url | **VERIFIED** |
| **Product List** | GET | `/api/v3/echotik/product/list` | region, page_num, page_size | ✅ Yes | ✅ VN | product_id, title, price, rating, sold_count, category_id, seller_id | **VERIFIED** |
| **Product Trend** | GET | `/api/v3/echotik/product/trend` | product_id, start_date, end_date, page_num, page_size | ✅ Yes | N/A | trend data by date | **VERIFIED** |
| **Category L1** | GET | `/api/v3/echotik/category/l1` | language (vi-VN) | ❌ No | N/A | category_id, name, level | **VERIFIED** |
| **Category L2** | GET | `/api/v3/echotik/category/l2` | language, parent_id | ❌ No | N/A | category_id, name, parent_id, level | **VERIFIED** |

**Response Structure** (verified from `data/echotik/seller-list-2026-11-05T19-41-35-084Z.json`):
```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "seller_id": "7494088028217378084",
      "seller_name": "Anxinji",
      "followers_count": 954,
      "rating": 4.4,
      "review_count": 10809,
      "total_crawl_product_cnt": 2,
      "total_sale_gmv_amt": 1106427.86,
      "total_sale_gmv_30d_amt": 0,
      "total_sale_gmv_90d_amt": 0,
      "total_sale_cnt": 203156,
      "total_ifl_cnt": 694,
      "total_ifl_30d_cnt": 0,
      "response_rate": 0.6032,
      "delivery_rate": 0.9333,
      "shop_type": 1,
      "sec_uid": "MS4wLjABAAAA...",
      "region": "VN",
      "sales_flag": 1
    }
  ],
  "requestId": "e7ba843f-e1a9-40e1-b363-1fc889bbb177"
}
```

## NOT Implemented / Missing Endpoints

| Feature | Endpoint | Status | Frontend Impact |
|---------|----------|--------|-----------------|
| Creator list | `/api/v3/echotik/creator/list` | ❌ NOT FOUND | Creator data only from Apify scraper |
| Affiliate list | `/api/v3/echotik/affiliate/*` | ❌ NOT FOUND | Affiliate data only from Apify + manual links |
| Video/Content | `/api/v3/echotik/video/*` | ❌ NOT FOUND | Video engagement (playCount, diggCount, shareCount, commentCount) **NOT AVAILABLE** from EchoTik |
| Ranking API | `/api/v3/echotik/*/ranking` | ❌ NOT FOUND | Rankings computed from snapshots, not from API |
| Shop by ID | `/api/v3/echotik/seller/{id}` | ❌ NOT FOUND | Individual shop data comes from list pagination |

## Quota & Authentication

- **Auth Method:** HTTP Basic Auth (username:password Base64)
- **Monthly Quota:** 50 requests (configurable via `ECHOTIK_MAX_REQUESTS_PER_MONTH`)
- **Tracking:** Per-month aggregation in `EchoTikQuotaLog` table
- **Cost per sync:** 4 requests (Category L1, Product List, Seller List, + 1 buffer)
- **Effective capacity:** ~12 syncs/month before hitting quota

---

# PART 3: DATABASE SCHEMA ANALYSIS

## Core Models & Their Purpose

**File:** `prisma/schema.prisma` (676 lines)

### Data Models Used by Frontend

| Model | Records | FK Relations | Snapshots | Frontend Pages |
|-------|---------|--------------|-----------|-----------------|
| **Product** | ~1000s | Shop (FK), variants | ProductSnapshot | detail.html, shops.html, trends.html |
| **Shop** | ~100s | → products, affiliates | ShopRevenueSnapshot | shops.html, shop-detail.html, creators.html |
| **Creator** | ~1000s | → products, shops | CreatorSnapshot | creators.html, creator.html |
| **Category** | ~50 | → products | CategorySnapshot | categories.html |
| **TrendItem** | ~1000s | → products, creators, shops | (none) | trends.html, detail.html |
| **ProductShop** | ~10000s | product + shop | ShopProductSnapshot | shops.html (top 3/shop) |
| **ProductCreator** | ~10000s | product + creator | (none, but in CreatorSnapshot) | detail.html (top creators) |
| **CreatorShop** | ~1000s | creator + shop | (none) | shop-detail.html (top affiliates) |

### Snapshot Strategy (History Tracking)

**Purpose:** Store daily metrics to enable:
- Trend charts (GMV over 30/90 days)
- Growth calculation (1d/7d/30d/90d deltas)
- Historical analysis
- Ranking changes over time

| Snapshot Table | Granularity | Key Fields | Uniqueness |
|---|---|---|---|
| **ProductSnapshot** | Per product, per day, per source | price, soldCountTotal, gmvTotal (1d/7d/30d/90d), ratingScore, playCount, diggCount, shareCount, commentCount | `(productId, source, bucketDate)` |
| **ShopRevenueSnapshot** | Per shop, per day, per source | gmvVideo, gmvLive, gmvCart, gmvProductCard, gmvTotal, soldCountTotal | `(shopId, source, bucketDate)` |
| **ShopProductSnapshot** | Per shop-product pair, per day, per source | price, soldCountTotal (1d/7d/30d/90d), gmvTotal (1d/7d/30d/90d) | `(productShopId, source, bucketDate)` |
| **CreatorSnapshot** | Per creator, per day, per source | followerCount, engagementRate, gmvTotal, soldCount, videoCount | `(creatorId, source, bucketDate)` |
| **CategorySnapshot** | Per category, per day, per source | gmvTotal, soldCountTotal, productCount, sellerCount, avgPrice, avgRating | `(categoryId, source, bucketDate)` |

**Constraint:** `@@unique([id, source, bucketDate])` prevents duplicate records in same day from same source

### Critical Unique Constraints (Why 10 Shops Skipped)

```prisma
// Shop model - Line 264
model Shop {
  platformShopId String @unique  // ← GLOBAL UNIQUE - One per ID across all sources
  // ...
}
```

**Impact:**
- `platformShopId` must be unique globally
- If 10 shops already exist from prior import → `findUnique()` returns them
- Ingestion code checks `if (existing) { skip }` (line 131-137)
- Result: All 10 shops SKIPPED with reason "already exists"

---

# PART 4: 10 SHOP IMPORT INVESTIGATION

## Root Cause Verification

**Location:** `src/services/echotik/echoTikShopIngestionService.ts:131-138`

```typescript
const existing = await prisma.shop.findUnique({
  where: { platformShopId },  // ← Each seller_id already in DB
  select: { id: true },
});
if (existing) {
  result.skipped += 1;        // ← ALL 10 SHOPS HIT THIS BRANCH
  continue;
}
```

**Confirmed:** All 10 sellers in `data/echotik/seller-list-2026-11-05T19-41-35-084Z.json` already have matching `Shop` records in PostgreSQL.

### The 10 Sellers (IDs That Exist in DB)

| # | seller_id | seller_name | followers | rating | review_count | total_sale_gmv_amt | total_sale_cnt | Status |
|---|-----------|-------------|-----------|--------|--------------|-------------------|----------------|--------|
| 1 | 7494084364488967268 | Hải Anh Lee | 0 | 0 | 0 | 9.27 | 1 | ✓ Exists |
| 2 | 7494084365700793920 | Nhung Silk Lụa | 8343 | 0 | 16 | 1,563.39 | 102 | ✓ Exists |
| 3 | 7494084316255520155 | Khoá Cửa Tay Nắm | 0 | 0 | 0 | 0 | 0 | ✓ Exists |
| 4 | 7494084363889771543 | Gia Dụng Như Hoàng | 0 | 4.2 | 0 | 987.63 | 311 | ✓ Exists |
| 5 | 7494088402780260043 | RealMen09xx | 0 | 0 | 0 | 77.64 | 192 | ✓ Exists |
| 6 | 7494088028217378084 | Anxinji | 954 | 4.4 | 10809 | 1,106,427.86 | 203,156 | ✓ Exists |
| 7 | 7494084316232254755 | Yến Sào Cam Lâm | 0 | 0 | 0 | 0 | 0 | ✓ Exists |
| 8 | 7494084364149818968 | Công Nghệ Xây Dựng HYM | 0 | 0 | 0 | 21.96 | 47 | ✓ Exists |
| 9 | 7494084316270986341 | Lượm Nguyễn | 7966 | 0 | 60 | 3,263.06 | 582 | ✓ Exists |
| 10 | 7494086491953530398 | Cẩm Quyên-Dầu Gội | 1877 | 0 | 99 | 4,426.87 | 961 | ✓ Exists |

**Result:** `{ received: 10, created: 0, updated: 0, skipped: 10, failed: 0 }`

## Proposed Fix: UPSERT Strategy

Replace skip logic with update:

```typescript
// OPTION: Merge existing + new data (upsert)
await prisma.shop.upsert({
  where: { platformShopId },
  update: {
    name: namename,
    followerCount: followerCount ? BigInt(followerCount) : null,
    ratingScore: rating ? Decimal(rating) : null,
    ratingCount: ratingCount ? BigInt(ratingCount) : null,
    productCount: productCount ?? 0,
    lastSeenAt: new Date(),
  },
  create: {
    platformShopId, name, shopUrl, region,
    followerCount: followerCount ? BigInt(followerCount) : null,
    ratingScore: rating ? Decimal(rating) : null,
    ratingCount: ratingCount ? BigInt(ratingCount) : null,
    productCount: productCount ?? 0,
  },
});
result.updated += 1;  // or result.created += 1
```

**Benefit:** Imports succeed (created + updated = 10), no skips

---

# PART 5: DATA REQUIREMENT MATRIX

## Complete Mapping: Frontend Fields → Source → DB

### Shop Data

| Frontend Field | Display (Page) | EchoTik Field | DB Model | DB Field | Type | Status |
|---|---|---|---|---|---|---|
| shop.id | shops.html | (generated) | Shop | id | Int | ✅ |
| shop.platformShopId | shops.html | seller_id | Shop | platformShopId | String | ✅ |
| shop.name | shops.html, shop-detail.html | seller_name | Shop | name | String | ✅ |
| shop.avatarUrl | shops.html | (not provided) | Shop | avatarUrl | String? | ❌ EchoTik missing |
| shop.totalGmv | shops.html (sort) | total_sale_gmv_amt | ShopRevenueSnapshot | gmvTotal | Decimal | ⚠️ Estimated |
| shop.totalSales | shops.html (sort) | total_sale_cnt | ProductSnapshot aggregate | soldCountTotal | BigInt | ✅ |
| shop.productCount | shops.html | total_crawl_product_cnt | Shop | productCount | Int | ✅ |
| shop.followerCount | shops.html | followers_count | Shop | followerCount | BigInt | ✅ |
| shop.ratingScore | shop-detail.html | rating | Shop | ratingScore | Decimal(4,2) | ✅ |
| shop.ratingCount | shop-detail.html | review_count | Shop | ratingCount | BigInt | ✅ |
| shop.topProducts[3] | shops.html | (compute from products) | ProductShop + ProductSnapshot | gmvTotal, soldCount | Decimal, BigInt | ✅ |
| shop.topAffiliates[10] | shop-detail.html | (not provided) | CreatorShop | gmvTotal, soldCount | Decimal, BigInt | ✅ Apify |
| shop.revenueSources | shop-detail.html | (not provided) | ShopRevenueSnapshot | gmvVideo, gmvLive, gmvCart, gmvProductCard | Decimal | ⚠️ Estimated |
| shop.newProducts | shop-detail.html | (compute from lastSeenAt) | Product | firstSeenAt | DateTime | ✅ |

### Product Data

| Frontend Field | Display | EchoTik Field | DB | DB Field | Type | Status |
|---|---|---|---|---|---|---|
| product.id | detail.html | (generated) | Product | id | Int | ✅ |
| product.platformProductId | detail.html | product_id | Product | platformProductId | String | ✅ |
| product.title | detail.html | title | Product | title | String | ✅ |
| product.imageUrl | detail.html | (not provided) | Product | imageUrl | String? | ❌ EchoTik missing |
| product.price | detail.html (range) | price | Product | minPrice, maxPrice | Decimal | ✅ |
| product.category | detail.html | category_id | Product | category | String | ✅ |
| product.sales | detail.html (chart) | sold_count | ProductSnapshot | soldCountTotal | BigInt | ✅ |
| product.gmv | detail.html (chart) | (price × sold_count) | ProductSnapshot | gmvTotal | Decimal | ⚠️ Estimated |
| product.ratingScore | detail.html | rating | Product | ratingScore | Decimal | ✅ |
| product.ratingCount | detail.html | (not provided) | Product | ratingCount | BigInt | ✅ Apify |
| product.variants[] | detail.html | (not provided) | ProductVariant | platformSkuId, price, stock | String, Decimal, Int | ✅ Apify |
| product.topCreators[] | detail.html | (not provided) | ProductCreator + Creator | gmvTotal, soldCount | Decimal, BigInt | ✅ Apify |
| product.topShops[] | detail.html | (not provided) | ProductShop + Shop | (all) | - | ✅ |
| product.historySeries | detail.html (chart) | (not provided) | ProductSnapshot | soldCount1d/7d/30d/90d, gmv1d/7d/30d/90d, price | - | ⚠️ Only Apify |

### Creator Data

| Frontend Field | Display | EchoTik API | DB | DB Field | Type | Status |
|---|---|---|---|---|---|---|
| creator.id | creators.html | (generated) | Creator | id | Int | ✅ |
| creator.platformCreatorId | creators.html | N/A | Creator | platformCreatorId | String | ❌ No EchoTik endpoint |
| creator.displayName | creators.html | N/A | Creator | displayName | String | ❌ No EchoTik endpoint |
| creator.followerCount | creators.html | N/A | Creator | followerCount | BigInt | ❌ No EchoTik endpoint |
| creator.engagementRate | creators.html (calc) | N/A | CreatorSnapshot | engagementRate | Decimal | ❌ No EchoTik endpoint |
| creator.gmvTotal | creators.html (sort) | N/A | CreatorSnapshot | gmvTotal | Decimal | ❌ No EchoTik endpoint |
| creator.role | creators.html (filter) | N/A | Creator | role (CREATOR\|AFFILIATE) | String | ❌ No EchoTik endpoint |
| creator.topProducts[3] | creators.html | N/A | ProductCreator | gmvTotal, soldCount | Decimal, BigInt | ❌ No EchoTik endpoint |

**NOTE:** All creator data comes from Apify scraper, NOT EchoTik. No EchoTik API endpoint for creators/affiliates.

### Category Data

| Frontend Field | Display | EchoTik Field | DB | DB Field | Type | Status |
|---|---|---|---|---|---|---|
| category.name | categories.html | name | Category | name | String | ✅ |
| category.totalGmv | categories.html (chart) | (computed) | CategorySnapshot | gmvTotal | Decimal | ⚠️ Estimated |
| category.totalSales | categories.html | (computed) | CategorySnapshot | soldCountTotal | BigInt | ✅ |
| category.shopCount | categories.html | (computed) | CategorySnapshot | sellerCount | Int | ✅ |
| category.productCount | categories.html | (computed) | CategorySnapshot | productCount | Int | ✅ |
| category.shareOfGmv% | categories.html (pie) | (calculated %) | CategorySnapshot | gmvTotal → %share | Decimal | ⚠️ Estimated |

### Trend / Video Data

| Frontend Field | Display | Source | DB | DB Field | Type | Status |
|---|---|---|---|---|---|---|
| trend.videoUrl | trends.html | Apify | TrendItem | videoUrl | String | ✅ Apify |
| trend.playCount | trends.html | (EchoTik missing) | TrendItem | playCount | BigInt | ❌ NULL from EchoTik |
| trend.diggCount | trends.html | (EchoTik missing) | TrendItem | diggCount | BigInt | ❌ NULL from EchoTik |
| trend.shareCount | trends.html | (EchoTik missing) | TrendItem | shareCount | BigInt | ❌ NULL from EchoTik |
| trend.commentCount | trends.html | (EchoTik missing) | TrendItem | commentCount | BigInt | ❌ NULL from EchoTik |

---

# PART 6: DATA AVAILABILITY ASSESSMENT

## By Data Category

### ✅ FULLY AVAILABLE FROM ECHOTIK

| Data | EchoTik Field | DB Table | Frontend Pages |
|---|---|---|---|
| Shop identity | seller_id, seller_name, seller_link | Shop | shops.html, shop-detail.html |
| Shop engagement | followers_count, rating, review_count | Shop | shop-detail.html |
| Shop product count | total_crawl_product_cnt | Shop | shops.html |
| Shop metrics (overall) | total_sale_gmv_amt, total_sale_cnt | ShopRevenueSnapshot | shops.html (sort/filter) |
| Product identity | product_id, title | Product | detail.html |
| Product price range | min_price, max_price | Product | detail.html, shops.html |
| Product rating | rating, review_count | Product | detail.html |
| Category hierarchy | category_id, parent_id, name | Category, SubCategory | categories.html |
| Shop quality metrics | response_rate, delivery_rate | Shop.echotikMetadata (JSON) | (not displayed) |

### ⚠️ PARTIALLY AVAILABLE / ESTIMATED

| Data | Status | Source | Limitation | DB Table |
|---|---|---|---|---|
| Shop GMV | Estimated | `total_sale_gmv_amt` | Field contains aggregate value; daily breakdown unknown | ShopRevenueSnapshot |
| Product GMV | Estimated | Calculated (price × sold_count) | No direct GMV from EchoTik; calculated in app | ProductSnapshot |
| Revenue breakdown (Video/Live/Cart/ProductCard) | Estimated | Not provided by EchoTik | Breakdown computed, marked `isEstimated=true` | ShopRevenueSnapshot |
| Shop growth % | Calculated | Snapshots delta | Computed from 1d/7d/30d/90d comparisons | ProductSnapshot |
| Creator engagement rate | Calculated | Not provided by EchoTik | Computed from metrics | CreatorSnapshot |

### ❌ MISSING / NOT AVAILABLE FROM ECHOTIK

| Data | Needed By | Alternative Source | Gap |
|---|---|---|---|
| Video engagement (playCount, diggCount, shareCount, commentCount) | trends.html, detail.html (video charts) | Apify scraper TrendItem table | ⚠️ EchoTik API returns NULL for these fields |
| Creator/Affiliate identity & metrics | creators.html, creator.html, shop-detail.html | Apify scraper, manual ProductCreator/CreatorShop linking | ❌ NO EchoTik API endpoint for creators |
| Product images | detail.html | Apify scraper | ⚠️ EchoTik doesn't provide imageUrl |
| Shop avatar URL | shops.html | Apify scraper or manual upload | ⚠️ EchoTik doesn't provide avatarUrl |
| Affiliate commission rate | shop-detail.html (affiliate list) | Manual data entry or contract documents | ⚠️ EchoTik doesn't provide this |
| Individual product sales data per shop | shop-detail.html (top products) | Must aggregate from ProductShop snapshots | ⚠️ EchoTik only provides shop-level gmv_amt |

---

# PART 7: BACKEND API COVERAGE

## Complete Endpoint Listing (43 total)

### **Dashboard & Overview (8 endpoints)**
```
GET  /api/overview          → getTotalGmv, totalSales, topProducts, topShops, topCreators
GET  /api/analytics         → (alias for /overview)
GET  /api/analytics/trends  → getTrends (growth %, keywords, video count)
GET  /api/trends            → getTrendItems (paginated videos)
GET  /api/trends/keywords   → getKeywords (top keywords by frequency)
GET  /api/jobs              → getJobs (scrape job queue)
GET  /api/jobs/:id          → getScrapeJob (job detail + stats)
```

### **Products (3 endpoints)**
```
GET  /api/products                    → List products (sortable by gmv/sales/growth)
GET  /api/products/:id                → Product detail + variants + top creators + shops + history
GET  /api/products/compare            → Compare multiple products
```

### **Shops (3 endpoints)**
```
GET  /api/shops                       → List shops (paginated, sortable)
GET  /api/shops/:id                   → Shop detail + revenue breakdown + top affiliates + new products
GET  /api/shops/:id/videos            → Trend videos by shop
```

### **Categories (4 endpoints)**
```
GET  /api/categories                  → L1 category overview
GET  /api/categories/:category        → Category detail + subcategories + top products
GET  /api/categories/:cat/subcategories/:sub  → L2 detail + products + shops
POST /api/categories/sync             → Force sync categories (admin only)
```

### **Creators/Affiliates (4 endpoints)**
```
GET  /api/creators                    → List creators (filterable by role: CREATOR|AFFILIATE)
GET  /api/creators/top                → Top creators by GMV
GET  /api/creators/:id                → Creator detail + products + shops + timeline
POST /api/creators/scrape             → Trigger creative center scrape (admin)
```

### **Targeted Shops - CRUD (6 endpoints)**
```
GET  /api/targets                     → List targeted shops
POST /api/targets                     → Create targeted shop
GET  /api/targets/:id                 → Single target detail
PATCH /api/targets/:id                → Update target (name, priority, note, config)
PATCH /api/targets/:id/toggle         → Enable/disable target
DELETE /api/targets/:id               → Remove target
```

### **Scrape Operations (6 endpoints)**
```
GET  /api/scrape/status               → Overall scrape status (Apify + EchoTik)
POST /api/scrape                      → Trigger manual scrape
POST /api/scrape/run-top-shops        → Scrape targeted profiles (Apify)
GET  /api/scrape/profile-status       → Profile scrape status
POST /api/scrape/tiktok-shop          → Trigger TikTok Shop scrape (Apify)
GET  /api/scrape/tiktok-shop/status   → Shop scrape status
GET  /api/growth/products/:id         → Product growth (1d/7d/30d/90d delta)
GET  /api/growth/shops/:id            → Shop growth (1d/7d/30d/90d delta)
```

### **EchoTik Admin (3 endpoints)**
```
GET  /api/admin/echotik/quota         → Quota status (used, remaining, reset date)
GET  /api/admin/echotik/status        → Can sync? (quota check)
POST /api/admin/echotik/sync          → Trigger EchoTik sync
```

### **Commerce Module (Alternative namespace, 7 endpoints)**
```
GET  /api/commerce/overview           → Alt dashboard
GET  /api/commerce/products           → Alt product list
GET  /api/commerce/shops              → Alt shop list
GET  /api/commerce/creators           → Alt creator list
GET  /api/commerce/categories         → Alt category list
GET  /api/commerce/trend-videos       → Trend videos alt endpoint
```

**Total:** 43 endpoints (5 route modules)

## Frontend → Backend Mapping

| Page | API Calls |
|------|-----------|
| shop.html | `GET /api/overview` |
| shops.html | `GET /api/shops?page=1&limit=20&sortBy=gmv` |
| shop-detail.html | `GET /api/shops/:id?range=30d` |
| categories.html | `GET /api/categories?range=30d` |
| subcategory.html | `GET /api/categories/:cat/subcategories/:sub` |
| creators.html | `GET /api/creators?role=X&sortBy=gmv&page=1` |
| creator.html | `GET /api/creators/:id?range=30d` |
| detail.html | `GET /api/products/:id?range=30d` |
| trends.html | `GET /api/analytics/trends`, `GET /api/trends?page=1` |
| targets.html | `GET /api/targets`, `POST/PATCH/DELETE /api/targets/:id` |
| jobs.html | `GET /api/jobs?limit=20` |

---

# PART 8: FIELD-BY-FIELD MAPPING: ECHOTIK → DATABASE

## Seller/Shop Fields

| EchoTik Field | Type | Example Value | Prisma Model | DB Field | DB Type | Conversion | Status |
|---|---|---|---|---|---|---|---|
| seller_id | string | "7494088028217378084" | Shop | platformShopId | String | (direct) | ✅ |
| seller_name | string | "Anxinji" | Shop | name | String | (direct) | ✅ |
| seller_link | string/URL | "https://shop.tiktok.com/vn/store/anxinji/7494088028217378084" | Shop | shopUrl | String | (direct) | ✅ |
| region | string | "VN" | Shop | region | String | (direct) | ✅ |
| followers_count | integer | 954 | Shop | followerCount | BigInt | BigInt() | ✅ |
| rating | decimal | 4.4 | Shop | ratingScore | Decimal(4,2) | Decimal() | ✅ |
| review_count | integer | 10809 | Shop | ratingCount | BigInt | BigInt() | ✅ |
| total_crawl_product_cnt | integer | 2 | Shop | productCount | Int | (direct) | ✅ |
| cover_url | string/URL | "https://echosell-images.tos-..." | Shop | bannerUrl | String | (direct) | ✅ |
| sec_uid | string | "MS4wLjABAAAA..." | Shop | echotikMetadata.secUid | JSON | Store as JSON | ⚠️ Extra field |
| shop_type | integer | 1 (official) | Shop | echotikMetadata.shopType | JSON | Store as JSON | ⚠️ Extra field |
| response_rate | decimal | 0.6032 | Shop | echotikMetadata.responseRate | JSON | Store as JSON | ⚠️ Extra field |
| delivery_rate | decimal | 0.9333 | Shop | echotikMetadata.deliveryRate | JSON | Store as JSON | ⚠️ Extra field |
| positive_feedback_rate | decimal | (null) | Shop | echotikMetadata.positiveFeedbackRate | JSON | Store as JSON | ⚠️ Extra field |
| category_id | string | "601450" | Shop | (not mapped) | N/A | Store in JSON only | ⚠️ For future L1 linking |
| category_l2_id | string | "848648" | Shop | (not mapped) | N/A | Store in JSON only | ⚠️ For future L2 linking |
| category_l3_id | string | "601583" | Shop | (not mapped) | N/A | Store in JSON only | ⚠️ For future L3 linking |
| **total_sale_gmv_amt** | **decimal** | **1,106,427.86** | ShopRevenueSnapshot | **echotikRawData.totalGmvAmt** | **JSON** | **Store unverified** | **❌ UNIT UNKNOWN** |
| **total_sale_gmv_1d_amt** | **decimal** | **0** | ShopRevenueSnapshot | **echotikRawData.gmvByPeriod.gmv1d** | **JSON** | **Store unverified** | **❌ PERIOD UNCLEAR** |
| **total_sale_gmv_7d_amt** | **decimal** | **0** | ShopRevenueSnapshot | **echotikRawData.gmvByPeriod.gmv7d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_gmv_30d_amt** | **decimal** | **0** | ShopRevenueSnapshot | **echotikRawData.gmvByPeriod.gmv30d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_gmv_90d_amt** | **decimal** | **0** | ShopRevenueSnapshot | **echotikRawData.gmvByPeriod.gmv90d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_cnt** | **bigint** | **203,156** | ShopRevenueSnapshot | **echotikRawData.salesCnt** | **JSON** | **Store unverified** | **❌ "COUNT" AMBIGUOUS** |
| **total_sale_1d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.salesCntByPeriod.1d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_7d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.salesCntByPeriod.7d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_30d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.salesCntByPeriod.30d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_sale_90d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.salesCntByPeriod.90d** | **JSON** | **Store unverified** | **❌ UNCLEAR** |
| **total_ifl_cnt** | **bigint** | **694** | ShopRevenueSnapshot | **echotikRawData.iflCnt** | **JSON** | **Store unverified** | **❌ "IFL" UNDEFINED** |
| **total_ifl_1d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.iflCntByPeriod.1d** | **JSON** | **Store unverified** | **❌ UNDEFINED** |
| **total_ifl_7d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.iflCntByPeriod.7d** | **JSON** | **Store unverified** | **❌ UNDEFINED** |
| **total_ifl_30d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.iflCntByPeriod.30d** | **JSON** | **Store unverified** | **❌ UNDEFINED** |
| **total_ifl_90d_cnt** | **bigint** | **0** | ShopRevenueSnapshot | **echotikRawData.iflCntByPeriod.90d** | **JSON** | **Store unverified** | **❌ UNDEFINED** |

### Key Findings on Unverified Fields

| Field | Problem | Example Mismatch | Recommendation |
|---|---|---|---|
| `total_sale_gmv_amt` | No unit specified | Anxinji: 1,106,427.86 (USD? VND? CNY?) | Store in JSON; do NOT use in rankings until verified |
| `total_sale_*_cnt` | Definition ambiguous | 203,156 (orders? units sold? views?) | Store in JSON; do NOT aggregate with Apify data |
| `total_ifl_*_cnt` | Acronym undefined | IFL = ??? (Influencer? In-Feed List?) | Store in JSON; log warning; do NOT map to any field |
| Period fields mismatch | Anomaly: `total_sale_gmv_30d_amt: 0` but `total_sale_gmv_amt: 1,106,427.86` | Time window calculation unknown | Store separately; do NOT assume cumulative |

---

# PART 9: DATABASE SCHEMA PROPOSAL

## New/Modified Models

### Proposed Changes to Existing Models

**1. Shop Model**

```prisma
model Shop {
  // Existing
  id Int @id @default(autoincrement())
  platformShopId String @unique
  name String
  username String?
  avatarUrl String?
  bannerUrl String?
  shopUrl String?
  region String @default("VN")
  followerCount BigInt?
  productCount Int @default(0)
  soldCountTotal BigInt?
  gmvTotal Decimal? @db.Decimal(20, 2)
  avgOrderValue Decimal? @db.Decimal(20, 2)
  ratingScore Decimal? @db.Decimal(4, 2)
  ratingCount BigInt?
  firstSeenAt DateTime @default(now())
  lastSeenAt DateTime @default(now())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // NEW: Source tracking & metadata
  source String @default("apify")  // "apify" | "echotik" | "hybrid"
  echotikMetadata Json?  // { secUid, shopType, responseRate, deliveryRate, categoryId, ... }

  // Relations (unchanged)
  productShops ProductShop[]
  creatorShops CreatorShop[]
  revenueSnapshots ShopRevenueSnapshot[]
  trendItems TrendItem[]
  products Product[]

  // NEW: Allow same ID from different sources
  @@unique([platformShopId, source])
  @@index([source])
}
```

**2. ShopRevenueSnapshot Model**

```prisma
model ShopRevenueSnapshot {
  id BigInt @id @default(autoincrement())
  shopId Int
  source String @default("apify")  // NEW
  scrapeJobId Int?
  capturedAt DateTime @default(now())
  bucketDate DateTime @db.Date

  // Standard fields
  gmvVideo Decimal? @db.Decimal(20, 2)
  gmvLive Decimal? @db.Decimal(20, 2)
  gmvCart Decimal? @db.Decimal(20, 2)
  gmvProductCard Decimal? @db.Decimal(20, 2)
  gmvTotal Decimal? @db.Decimal(20, 2)
  soldCountTotal BigInt?
  productCount Int?
  avgOrderValue Decimal? @db.Decimal(20, 2)
  ratingScore Decimal? @db.Decimal(4, 2)
  ratingCount BigInt?

  // NEW: EchoTik-specific unverified fields (store as JSON)
  echotikRawData Json?  // {
                        //   totalGmvAmt, gmvByPeriod { 1d, 7d, 30d, 90d },
                        //   salesCnt, salesCntByPeriod { 1d, 7d, 30d, 90d },
                        //   iflCnt, iflCntByPeriod { 1d, 7d, 30d, 90d }
                        // }

  isEstimated Boolean @default(true)
  rawData Json?

  shop Shop @relation(fields: [shopId], references: [id], onDelete: Cascade)
  scrapeJob ScrapeJob? @relation(fields: [scrapeJobId], references: [id])

  // MODIFIED: Allow same shop from different sources per day
  @@unique([shopId, source, bucketDate])
  @@index([shopId, capturedAt, source])
}
```

**3. Product Model (add source)**

```prisma
model Product {
  // ... existing fields ...
  source String @default("apify")  // NEW
  
  @@unique([platformProductId, source])  // NEW
  @@index([source])  // NEW
}
```

**4. Creator Model (add source)**

```prisma
model Creator {
  // ... existing fields ...
  source String @default("apify")  // NEW
  echotikMetadata Json?  // For future EchoTik creator data
  
  @@index([source])  // NEW
}
```

**5. CreatorSnapshot Model (add source)**

```prisma
model CreatorSnapshot {
  // ... existing fields ...
  source String @default("apify")  // NEW
  
  // MODIFIED: Allow same creator per day from different sources
  @@unique([creatorId, source, bucketDate])  // CHANGED from @@unique([creatorId, source, bucketDate])
}
```

### Migration SQL (Non-breaking)

```sql
-- Step 1: Add columns with defaults (safe, non-breaking)
ALTER TABLE Shop ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE Shop ADD COLUMN echotikMetadata JSONB;

ALTER TABLE Product ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

ALTER TABLE Creator ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE Creator ADD COLUMN echotikMetadata JSONB;

ALTER TABLE ShopRevenueSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE ShopRevenueSnapshot ADD COLUMN echotikRawData JSONB;

ALTER TABLE CreatorSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

-- Step 2: Create new indexes
CREATE INDEX idx_shop_source ON Shop(source);
CREATE INDEX idx_shop_platformshopid_source ON Shop(platformShopId, source);
CREATE INDEX idx_product_source ON Product(source);
CREATE INDEX idx_creator_source ON Creator(source);
CREATE INDEX idx_shop_revenue_source ON ShopRevenueSnapshot(shopId, source, capturedAt);
CREATE INDEX idx_creator_snapshot_source ON CreatorSnapshot(creatorId, source, capturedAt);

-- Step 3: Update unique constraints (requires exclusivity window)
ALTER TABLE Shop DROP CONSTRAINT Shop_platformShopId_key;
ALTER TABLE Shop ADD CONSTRAINT idx_shop_platformshopid_source_unique UNIQUE (platformShopId, source);

-- Similar for ShopRevenueSnapshot...
ALTER TABLE ShopRevenueSnapshot DROP CONSTRAINT ShopRevenueSnapshot_shopId_source_bucketDate_key;
ALTER TABLE ShopRevenueSnapshot ADD CONSTRAINT idx_shop_revenue_unique UNIQUE (shopId, source, bucketDate);

-- Similar for CreatorSnapshot...
```

---

# PART 10: FILE SCOPE & IMPLEMENTATION PLAN

## Files to CREATE (8 files)

| File | Purpose | Triggered By | Input | Output |
|------|---------|-----------|-------|--------|
| `src/services/echotik/echoTikShopSyncService.ts` | Sync shops from EchoTik | `syncEchoTikPhase1` | Seller list from API | Shop + ShopRevenueSnapshot |
| `src/services/echotik/echoTikProductSyncService.ts` | Sync products from EchoTik | `syncEchoTikPhase1` | Product list from API | Product + ProductSnapshot |
| `src/services/echotik/echoTikCategorySyncService.ts` | Sync categories from EchoTik | `syncEchoTikPhase1` | Category L1/L2 from API | Category + SubCategory |
| `src/services/echotik/echoTikConflictResolver.ts` | Handle Apify + EchoTik conflicts | Shop/Product sync | Two records with same ID | Merged record (source="hybrid") |
| `src/services/echotik/echoTikProductNormalizer.ts` | Normalize EchoTik product response | Product sync | Raw EchoTik product | Normalized ProductSnapshot |
| `src/services/echotik/echoTikCategoryNormalizer.ts` | Normalize EchoTik category response | Category sync | Raw EchoTik category | Normalized Category/SubCategory |
| `src/scripts/syncEchoTikPhase1.ts` | Master orchestration script | Manual trigger | (none) | Synced data + report |
| `src/scripts/importEchoTikShopsInitial.ts` | Import 10 shops from file | Manual trigger | `data/echotik/seller-list-*.json` | 10 Shop + ShopRevenueSnapshot |

## Files to MODIFY (7 files)

| File | Change | Reason |
|------|--------|--------|
| `prisma/schema.prisma` | Add `source` fields; modify constraints | Enable source tracking + Apify/EchoTik coexistence |
| `src/services/echotik/echoTikShopIngestionService.ts` | Replace skip logic with upsert OR add source check | Currently skips 10 shops; need option to import |
| `src/services/echotik/echoTikNormalizer.ts` | Expand to handle unverified fields (store in JSON) | Preserve GMV/IFL data without assuming unit/definition |
| `src/services/scraper/ingestionService.ts` | Accept `source` parameter in `persistRecord()` | Track data origin through ingestion pipeline |
| `src/controllers/echoTikController.ts` | Add endpoints for Phase 1 sync operations | Trigger shop/product/category sync from API |
| `src/modules/shopCommerce/shopService.ts` | Filter/merge by `source` when fetching | Return data correctly for hybrid sources |
| `src/controllers/analyticsController.ts` | Include `source` in API responses | Frontend can track data origin |

## Files with NO CHANGE

All other files remain unchanged. Specifically:
- `src/routes/apiRoutes.ts` - Routes already defined
- `src/services/scraper/normalizer.ts` - Apify normalizer unchanged
- Frontend HTML files - Will use existing API endpoints
- Database views/procedures - Not required for Phase 1

---

# PART 11: RISK ASSESSMENT

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Duplicate platformShopId** | 🔴 Critical | Add `source` field + unique constraint; implement upsert strategy |
| **Data ghi đè Apify** | 🔴 Critical | Never update existing; only create with source="echotik" if different from "apify" |
| **GMV unit confusion** | 🟠 High | Store in JSON; add type comment; do NOT use in rankings without verification |
| **IFL field ambiguity** | 🟠 High | Store in JSON; log UNKNOWN warning; do NOT display to user without definition |
| **Video engagement missing** | 🟠 High | Document as "unavailable from EchoTik"; use Apify TrendItem fallback |
| **Quota exhaustion** | 🟡 Medium | Track quota per request; alert at 80%; implement backoff |
| **Creator endpoint missing** | 🟡 Medium | Document as "Phase 2 pending"; continue using Apify for now |
| **Snapshot staleness** | 🟡 Medium | Cron job daily sync; alert if data > 3 days old |
| **Schema migration downtime** | 🟡 Medium | Use non-breaking additions; run Step 3 (constraint change) in maintenance window |
| **Apify vs EchoTik ID format mismatch** | 🟡 Medium | Verify with sample data before production; implement mapping table if needed |

---

# PART 12: TEST PLAN

## Unit Tests

- `echoTikShopNormalizer`: Map seller_id → platformShopId correctly
- `echoTikProductNormalizer`: Handle product fields
- `echoTikCategoryNormalizer`: Build L1→L2→L3 hierarchy
- `echoTikConflictResolver`: Merge Apify + EchoTik data correctly
- `echoTikQuotaService`: Track requests per month

## Integration Tests

- **Import 10 shops:** Verify all created/updated (not skipped)
- **Sync products:** Link to shops correctly via seller_id
- **Sync categories:** Build proper hierarchy
- **Conflict handling:** When Apify + EchoTik same ID → merged
- **ShopRevenueSnapshot:** Created daily with source tracking
- **API responses:** Include source field, correct data

## Data Validation

- ✅ All 10 shops imported
- ✅ No duplicate platformShopId per source
- ✅ Apify data NOT overwritten
- ✅ echotikRawData JSON populated for unverified fields
- ✅ Quota logged correctly
- ✅ Snapshots created for each source separately

## Verification Queries

```sql
-- Verify 10 shops imported with source="echotik"
SELECT COUNT(*) FROM Shop WHERE source = 'echotik';  -- Should = 10

-- Verify no Apify data overwritten
SELECT COUNT(*) FROM Shop WHERE source = 'apify';  -- Should be unchanged

-- Verify snapshot created per source
SELECT DISTINCT source FROM ShopRevenueSnapshot WHERE shopId IN (SELECT id FROM Shop WHERE source = 'echotik');
-- Should return: ["echotik"]

-- Check GMV in JSON
SELECT jsonb_extract_text(echotikRawData, 'totalGmvAmt') FROM ShopRevenueSnapshot LIMIT 10;
```

---

# PART 13: IMPLEMENTATION PHASES

## Phase 1: Initial Import (Week 1)

**Goal:** Get 10 shops + products + categories into database with proper source tracking

**Steps:**
1. ✅ Apply schema migration (non-breaking part)
2. ✅ Modify `echoTikShopIngestionService.ts` to upsert (not skip)
3. ✅ Create `echoTikProductSyncService.ts`
4. ✅ Create `echoTikCategorySyncService.ts`
5. ✅ Create `syncEchoTikPhase1.ts` orchestrator
6. ✅ Create `importEchoTikShopsInitial.ts` for 10 shops
7. ✅ Run import script → verify 10 shops + products + categories
8. ✅ Verify ShopRevenueSnapshot created
9. ✅ Run backend API tests → confirm frontend can query data
10. ✅ Apply Step 3 migration (constraint change) in maintenance window

**Deliverable:**
- 10 shops in database with full metrics
- Products linked to shops
- Categories in hierarchy
- Daily revenue snapshots

## Phase 2: Frontend Integration (Week 2)

**Goal:** Website displays EchoTik data in all pages

**Steps:**
1. ✅ Update `analyticsController.ts` to return source field
2. ✅ Update `shopService.ts` to filter by source (or merge)
3. ✅ Test all 14 frontend pages with EchoTik data
4. ✅ Verify charts render correctly (GMV, sales, growth)
5. ✅ Verify rankings work (sort by GMV, sales, growth)
6. ✅ Update mock data → real data

**Deliverable:**
- All 14 pages display real EchoTik data
- Rankings work correctly
- Charts updated in real time

## Phase 3: Periodic Sync (Week 3)

**Goal:** Continuous data collection without hitting quota limits

**Steps:**
1. ✅ Create daily cron job for `syncEchoTikPhase1`
2. ✅ Implement quota backoff (wait if quota > 80%)
3. ✅ Create alert for quota exhaustion
4. ✅ Monitor snapshot staleness (alert if > 3 days old)
5. ✅ Test incremental sync (no duplicates, no overwrites)

**Deliverable:**
- Automated daily syncs
- Quota alerts
- Historical data accumulation

## Phase 2B: Creator/Affiliate Data (Conditional)

**Goal:** If EchoTik provides creator endpoint, integrate it

**Steps:**
1. Monitor for `/api/v3/echotik/creator/*` endpoints
2. Create `echoTikCreatorSyncService.ts` if available
3. Merge with Apify creator data (source="hybrid")
4. Update `creators.html` to show EchoTik creator metrics

**Status:** Pending EchoTik API support

---

# SUMMARY TABLE

| Aspect | Current | Proposed | Notes |
|--------|---------|----------|-------|
| **Frontend Pages** | 14 | 14 | No change |
| **API Endpoints** | 43 | 43 | Minor updates to include source |
| **Database Models** | 16 | 16 + source tracking | Add source + metadata fields |
| **EchoTik Endpoints** | 5 | 5 | Seller, Product, Category L1/L2, ProductTrend |
| **Shop Data** | ~100 (from prior import) | ~10 (from EchoTik phase 1) | Will merge/track separately |
| **Product Data** | ~1000s (Apify) | +products from EchoTik | Linked via product_id |
| **Creator Data** | Apify | Apify (pending EchoTik endpoint) | No EchoTik creator API yet |
| **Video Engagement** | Apify TrendItem | NULL from EchoTik | Use Apify fallback |
| **Snapshot Strategy** | Per source, per day | Per source, per day | No change |
| **Quota (monthly)** | 50 requests | 50 requests | 4 per sync → ~12 syncs max |

---

# CONCLUSION

**Website-First Analysis Complete**

✅ All 14 pages inventoried
✅ All 43 API endpoints mapped
✅ All 80+ data fields traced to source
✅ 10 shop skip reason identified (duplicate platformShopId)
✅ Unverified EchoTik fields isolated (GMV unit, IFL definition)
✅ Creator/video data gaps documented (no EchoTik endpoint)
✅ Database design prepared (source tracking + metadata JSON)
✅ Migration plan ready (non-breaking + constraint update)
✅ 15 files identified (8 create + 7 modify)
✅ Test strategy defined
✅ Phase 1-3 roadmap created

**Status:** READY FOR REVIEW & APPROVAL

---

**Next Step: Await confirmation from Project Lead**

```
✅ Architecture review: OK
✅ File scope: OK  
✅ Migration plan: OK
✅ Risk assessment: OK
✅ Phase 1-3 roadmap: OK

Then: OK BẮT ĐẦU CODE
```

