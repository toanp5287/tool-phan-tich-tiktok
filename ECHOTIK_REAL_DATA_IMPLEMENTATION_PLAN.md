# KẾ HOẠCH TRIỂN KHAI: XÂY DỰNG KHO DỮ LIỆU THẬT TỪ ECHOTIK

**Ngày:** 2026-11-06  
**Mục tiêu:** Thu thập DỮ LIỆU THẬT từ EchoTik API → PostgreSQL → 14 Frontend Pages  
**Phương châm:** Không giới hạn 10 shops. Lấy TẤT CẢ dữ liệu API cung cấp. Kết nối toàn bộ website.

---

## PHẦN 1: HIỆN TRẠNG VÀ GIỚI HẠN

### 1.1 EchoTik API — Endpoints Thực Tế Hỗ Trợ
Từ `echoTikClient.ts` và báo cáo phân tích hiện có:

✅ **CÓ (5 endpoints):**
```
1. GET /api/v3/echotik/seller/list?region=VN&page_num=X&page_size=Y
   → Shops: name, rating, follower, products, GMV, IFL metrics
   → Supports pagination

2. GET /api/v3/echotik/product/list?region=VN&page_num=X&page_size=Y
   → Products: title, price, seller_id, category, sold count, rating
   → Supports pagination

3. GET /api/v3/echotik/product/trend?product_id=X&start_date=Y&end_date=Z&page_num=P&page_size=Q
   → Product trend data over time period
   → Supports pagination

4. GET /api/v3/echotik/category/l1?language=vi-VN
   → Level 1 categories (no pagination)

5. GET /api/v3/echotik/category/l2?language=vi-VN&parent_id=X
   → Level 2 categories per L1 (no pagination)
```

❌ **KHÔNG CÓ (BLOCKED):**
```
- Creator/Affiliate endpoints
- Video/Content endpoints
- Shop/Product ranking endpoints
- L3 category endpoint (data exists in seller response but no dedicated endpoint)
```

### 1.2 EchoTik Quota Limit
- **50 requests/month** (xem `.env`)
- **Hiện tại:** 4 requests đã dùng (test phase)
- **Còn lại:** 46 requests

**Strategy:** Mỗi phase phải tối ưu số API calls
- Phase 1a: Get all categories (2-3 requests) — L1 (1) + L2 per category (~2)
- Phase 1b: Get all shops (pagination) — ~5-10 requests để lấy 500-1000 shops
- Phase 1c: Get all products (pagination) — ~5-10 requests
- Phase 2: Product trends (on-demand) — Save for later

### 1.3 Data Mapping Issues Từ Báo Cáo

**CHƯA XÁC MINH:**
1. **Apify seller_id vs EchoTik seller_id:** Có match không? Format giống không?
2. **EchoTik GMV units:** `total_sale_gmv_amt` là USD, VND hay CNY?
3. **IFL fields:** `total_ifl_*_cnt` nghĩa là gì? (Influencer Flow? Sales?)
4. **Product ID match:** Apify `item.productId` == EchoTik `product_id`?

**KHÔNG CÓ:**
- Revenue breakdown (video/live/cart) — EchoTik chỉ có `total_sale_gmv_amt`
- Creator/Affiliate data — No endpoint
- Video engagement — No endpoint
- Official rankings — Must calculate from snapshots

---

## PHẦN 2: KIẾN TRÚC ETL

### 2.1 Data Flow

```
EchoTik API
    ↓
Raw JSON Response
    ↓
Normalize + Validate (echoTikNormalizer.ts)
    ↓
Check Conflicts (avoid overwriting Apify)
    ↓
Upsert to PostgreSQL
    ├── Shop table (with source tracking)
    ├── ShopRevenueSnapshot (daily/period)
    ├── Product table
    ├── ProductSnapshot (daily)
    ├── Category table
    └── SubCategory table
    ↓
Backend API Queries
    ↓
Frontend Display (14 pages)
```

### 2.2 Key Design Decisions

#### A. Source Tracking (CRITICAL)
**Problem:** Apify đã lưu shops. EchoTik muốn thêm shops với cùng ID.
**Solution:** Add `source` field to Shop model

```prisma
model Shop {
  platformShopId String    // TikTok ID
  source         String    // "apify" | "echotik" | "hybrid"
  
  @@unique([platformShopId, source])  // Allow same ID from different sources
}
```

**Cost:** 1 migration (ADD COLUMN + change unique constraint)

#### B. Upsert Strategy
```typescript
// For each entity:
const existing = await prisma.[table].findUnique({
  where: { platformId_source: { platformId: echotikData.id, source: 'echotik' } }
});

if (existing) {
  // Update specific fields only (don't overwrite all)
  await prisma.[table].update({
    where: { id: existing.id },
    data: {
      // EchoTik-specific fields
      ratingScore, ratingCount, productCount,
      // Metadata for tracking
      echotikMetadata: { ...extraFields }
    }
  });
} else {
  // Create new
  await prisma.[table].create({ data: echotikData });
}
```

#### C. Snapshot Strategy
```
ShopRevenueSnapshot (daily/period):
  - Store metrics per source per date
  - @@unique([shopId, source, bucketDate])
  - Query: SELECT ... FROM ShopRevenueSnapshot 
           WHERE shopId=X AND source='echotik' 
           ORDER BY bucketDate DESC
  - Use for historical charts

ProductSnapshot (daily):
  - Same pattern as ShopRevenueSnapshot
```

#### D. Pagination & Resume
```typescript
// Store progress per entity type
interface SyncProgress {
  entityType: 'shop' | 'product' | 'category' | 'trend'
  lastPage: number
  totalFetched: number
  totalFailed: number
  lastRunAt: Date
  nextRunAt: Date  // When to resume if interrupted
}

// Resume-capable loop:
while (page <= maxPages) {
  try {
    const data = await echotikClient.fetch(page, pageSize);
    // Process & save
    await saveProgress(page);
  } catch (error) {
    if (isRetryable(error)) {
      saveProgress(page - 1);  // Save before page that failed
      break;  // Exit gracefully, resume next time
    }
  }
  page++;
}
```

---

## PHẦN 3: IMPLEMENTATION ROADMAP

### PHASE 1a: Schema & Infrastructure
**Duration:** 1 day  
**Files:**
- ✏️ `prisma/schema.prisma` — Add `source` field to Shop, Product, Creator
- ✏️ `.env` — Add `ECHOTIK_SYNC_CONFIG` (batch size, max pages per entity)

**Deliverable:**
- Schema migration (add source column)
- Composite unique constraints

---

### PHASE 1b: Category Ingestion
**Duration:** 1 day  
**API calls:** 2-3 (L1 once, L2 per L1 category)  
**Files:**
- ✨ `src/services/echotik/echoTikCategoryIngestionService.ts`
  ```typescript
  async function ingestEchoTikCategories() {
    // 1. Fetch L1 categories (1 call)
    const l1 = await echotikClient.getCategoryL1();
    
    // 2. For each L1, fetch L2 (N calls)
    for (const category of l1.data) {
      const l2 = await echotikClient.getCategoryL2(category.id);
      // Process & save
    }
    
    // 3. Upsert to DB (Category + SubCategory)
    for (const cat of l1.data) {
      await prisma.category.upsert({
        where: { name: cat.name },
        create: { name: cat.name, slug: cat.slug },
        update: { slug: cat.slug }
      });
    }
    
    return { created, updated, failed };
  }
  ```

**Testing:**
- Run ingestEchoTikCategories()
- Verify Category + SubCategory tables populated
- No duplicates

---

### PHASE 1c: Shop Ingestion
**Duration:** 2 days  
**API calls:** ~10 (to fetch 500-1000 shops with pagination)  
**Files:**
- ✨ `src/services/echotik/echoTikShopFullIngestionService.ts`
  ```typescript
  async function ingestEchoTikShops(maxPages = 50, pageSize = 20) {
    const result = { created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    
    for (let page = 1; page <= maxPages; page++) {
      try {
        const response = await echotikClient.getSellerList(page, pageSize, 'VN');
        const sellers = extractSellerRows(response);
        
        for (const seller of sellers) {
          const normalized = normalizeEchoTikShop(seller);
          
          // Find existing by platformShopId + source
          const existing = await prisma.shop.findFirst({
            where: {
              platformShopId: normalized.platformShopId,
              source: 'echotik'
            }
          });
          
          if (existing) {
            // Update only EchoTik-specific fields
            await prisma.shop.update({
              where: { id: existing.id },
              data: {
                ratingScore: normalized.ratingScore,
                ratingCount: normalized.ratingCount,
                productCount: normalized.productCount,
                echotikMetadata: normalized.metadata,
                lastSeenAt: new Date()
              }
            });
            result.updated++;
          } else {
            // Check if Apify version exists
            const apifyVersion = await prisma.shop.findUnique({
              where: { platformShopId: normalized.platformShopId }
            });
            
            if (apifyVersion && apifyVersion.source === 'apify') {
              // Create hybrid version
              await prisma.shop.create({
                data: { ...normalized, source: 'echotik' }
              });
              result.created++;
            } else if (!apifyVersion) {
              // Create new
              await prisma.shop.create({
                data: { ...normalized, source: 'echotik' }
              });
              result.created++;
            } else {
              result.skipped++;
            }
          }
          
          // Create/update ShopRevenueSnapshot for this day
          await prisma.shopRevenueSnapshot.upsert({
            where: {
              shopId_source_bucketDate: {
                shopId: shop.id,
                source: 'echotik',
                bucketDate: today
              }
            },
            create: {
              shopId: shop.id,
              source: 'echotik',
              bucketDate: today,
              gmvTotal: normalized.gmvTotal,  // If provided
              soldCountTotal: normalized.soldCountTotal
            },
            update: {
              gmvTotal: normalized.gmvTotal,
              soldCountTotal: normalized.soldCountTotal
            }
          });
        }
        
        // Check quota
        const quotaStatus = await getQuotaStatus();
        if (quotaStatus.usedThisMonth >= quotaStatus.totalQuota - 5) {
          console.log('⚠️ Approaching quota limit, stopping ingestion');
          break;
        }
        
      } catch (error) {
        result.failed++;
        result.errors.push(`Page ${page}: ${error.message}`);
        // Save progress and exit gracefully
        break;
      }
    }
    
    return result;
  }
  ```

**Testing:**
- Run with maxPages=5 first (safe)
- Verify shops created/updated in DB
- Check ShopRevenueSnapshot has data
- Verify no Apify data overwritten

---

### PHASE 1d: Product Ingestion
**Duration:** 2 days  
**API calls:** ~10 (similar to shops)  
**Files:**
- ✨ `src/services/echotik/echoTikProductFullIngestionService.ts`
  ```typescript
  async function ingestEchoTikProducts(maxPages = 50, pageSize = 20) {
    // Similar structure to shop ingestion
    // Key differences:
    // - Match product by platformProductId
    // - Link to Shop via seller_id
    // - Create ProductSnapshot with source='echotik'
    // - Handle price, ratings, sold counts
  }
  ```

---

### PHASE 1e: Product Trend Ingestion (ON-DEMAND)
**Duration:** 1 day  
**API calls:** On-demand (when user views product details)  
**Files:**
- ✨ `src/services/echotik/echoTikProductTrendService.ts`
  ```typescript
  async function fetchProductTrendForChart(productId, startDate, endDate) {
    // Called from backend when user requests chart
    // Stores result in TrendItem or ProductSnapshot
    // No batch ingestion yet (save quota)
  }
  ```

---

### PHASE 2a: Backend API Endpoints
**Duration:** 2 days  
**Files:**
- ✏️ `src/controllers/shopController.ts` — Add pagination, filtering
- ✏️ `src/controllers/productController.ts` — Add sorting, search
- ✏️ `src/controllers/categoryController.ts` — Category browsing
- ✨ `src/controllers/rankingController.ts` — Calculate rankings from snapshots

**Endpoints:**
```
GET /api/shops
  Query: region, category, sortBy (gmvTotal, followers, rating), page, limit
  Response: [{ id, name, followers, gmvTotal, rating, source, ... }]

GET /api/shops/:id
  Response: Shop + ShopRevenueSnapshot (chart data) + top products

GET /api/shops/:id/revenue-history
  Query: startDate, endDate
  Response: [{ date, gmv, source, ... }]

GET /api/products
  Query: category, sortBy (price, sold, rating), search, page, limit
  Response: [{ id, title, minPrice, maxPrice, soldCount, rating, shop, ... }]

GET /api/products/:id
  Response: Product + ProductSnapshot history + shop info

GET /api/categories
  Response: Category tree (L1 + L2)

GET /api/rankings/shops
  Query: metric (gmvTotal, followers, rating), period (1d, 7d, 30d)
  Response: [{ rank, shop, value, trend, ... }]

GET /api/rankings/products
  Query: metric (sold, gmv, rating), category, period
  Response: [{ rank, product, value, shop, ... }]
```

---

### PHASE 2b: Connect Frontend (14 Pages)
**Duration:** 3 days  
**Pages & Data:**

1. **Dashboard**
   - Top 10 shops by GMV → GET /api/rankings/shops?metric=gmvTotal&limit=10
   - Top 10 products by sales → GET /api/rankings/products?metric=sold&limit=10
   - Category breakdown → GET /api/categories

2. **Shop Ranking**
   - Sortable table → GET /api/shops?sortBy=gmvTotal&page=X
   - Filter by category → GET /api/shops?category=X&sortBy=gmvTotal

3. **Product Ranking**
   - Sortable by price, sold, rating → GET /api/products?sortBy=sold&page=X
   - Category filter → GET /api/products?category=X

4. **Shop Details**
   - Shop info + metrics → GET /api/shops/:id
   - Revenue history chart → GET /api/shops/:id/revenue-history?startDate=X&endDate=Y
   - Top products → GET /api/shops/:id/products?limit=10

5. **Product Details**
   - Product info + shop → GET /api/products/:id
   - Sales trend chart → GET /api/products/:id/sales-history
   - Shop link → GET /api/shops/:shopId

6. **Search**
   - Search shops → GET /api/shops?search=X&limit=20
   - Search products → GET /api/products?search=X&limit=20

7. **Compare**
   - Multiple shops → GET /api/shops?ids=1,2,3&compareFields=gmvTotal,followers,rating
   - Revenue comparison → GET /api/shops/:id/revenue-history?compareWith=:id2

8-14. **Other pages** → Use combination of above endpoints

---

## PHẦN 4: DATA QUALITY CHECKLIST

### 4.1 Verification Steps
- [ ] PostgreSQL has all shop records
- [ ] All shops have `source='echotik'`
- [ ] No Apify shops were modified or deleted
- [ ] ShopRevenueSnapshot populated for each shop
- [ ] Product table has EchoTik products
- [ ] Category/SubCategory hierarchy correct
- [ ] No duplicate platformIds (per source)

### 4.2 Data Integrity
- [ ] All required fields populated (no 100% NULLs)
- [ ] Numeric fields in correct ranges (prices > 0, ratings 0-5)
- [ ] Dates are valid (createdAt < updatedAt)
- [ ] Foreign keys valid (shopId → exists, productId → exists)

### 4.3 Frontend Verification
- [ ] Dashboard shows real data (not mocks)
- [ ] Rankings calculated correctly
- [ ] Charts show historical trends
- [ ] Filters work
- [ ] Search returns actual results
- [ ] No "N/A" or empty values for available data

---

## PHẦN 5: QUOTA & TIMELINE

### Quota Usage Plan
```
Category ingestion:    3 API calls (L1 + L2 × categories)
Shop ingestion:       10 API calls (pagination)
Product ingestion:    10 API calls (pagination)
Product Trends:        0 API calls (Phase 2, on-demand)
Buffer:               23 API calls
─────────────────────────────────────
Total:               46 calls available
```

### Timeline
```
Day 1:  Schema migration + Category ingestion
Day 2:  Shop ingestion (full dataset)
Day 3:  Product ingestion (full dataset)
Day 4:  Backend API endpoints
Day 5:  Frontend integration + verification
─────────────────
Total: 5 days (1 week)
```

---

## PHẦN 6: KNOWN LIMITATIONS & BLOCKERS

### Cannot Provide (EchoTik API doesn't support):
1. **Creator/Affiliate Data** — No endpoint
2. **Video/Content Data** — No endpoint
3. **Official Rankings** — Must calculate from snapshots
4. **Revenue Breakdown** — Only total GMV, no video/live/cart split
5. **Real-time Updates** — Snapshot-based only

### Must Verify from EchoTik Docs:
1. GMV units (USD/VND/CNY)
2. IFL fields definition
3. Product ID format match with Apify

### Migration Risks:
1. **Adding source column** — Must handle NULL values
2. **Composite unique constraint** — May conflict if data exists
3. **Data consistency** — Ensure Apify + EchoTik data don't corrupt

---

## PHẦN 7: SUCCESS CRITERIA

✅ **Mission Complete When:**
1. PostgreSQL contains 1000+ shops from EchoTik with `source='echotik'`
2. All 500+ products from EchoTik populated in Product table
3. All categories mapped and accessible
4. Backend API returns real data (verified via SQL)
5. All 14 frontend pages use real data (no mock data)
6. Historical charts show EchoTik snapshots
7. No Apify data was lost or overwritten
8. API quota managed (under 50 calls/month)

---

## NEXT STEPS

1. **Approve plan** — Confirm phạm vi, timeline, decisions
2. **Run Phase 1a** — Apply schema migration
3. **Run Phase 1b** — Ingest categories
4. **Run Phase 1c** — Ingest shops (test with maxPages=2 first)
5. **Run Phase 1d** — Ingest products
6. **Verify data** — SQL queries to confirm completeness
7. **Implement Phase 2a-2b** — Backend + Frontend
8. **Final test** — All pages working with real data

