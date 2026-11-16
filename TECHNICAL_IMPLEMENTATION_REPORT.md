# BÁOCÁO KỸ THUẬT TRIỂN KHAI ECHOTIK - TÍCH HỢP TOÀN DIỆN

**Ngày:** 2026-11-06  
**Trạng thái:** ✅ PHÂN TÍCH XONG - CHỜ PHẢI DUYỆT VÀ XÁC NHẬN  
**Phạm vi:** Không giới hạn 10 shop - Thu thập đầy đủ Seller, Product, Category, Creator, Affiliate, Trends, Rankings

---

## I. ĐIỂM KHÁC BIỆT: APIFY vs ECHOTIK

### 1.1 Shop/Seller ID

**Apify:**
- Field: `item.shopId` (priority 1) hoặc `item.sellerId` (priority 2)
- Type: `string | number`
- Storage: `Shop.platformShopId` (string, @unique)
- Format: Chưa xác minh chính xác

**EchoTik:**
- Field: `seller_id`
- Type: `string` (numeric)
- Example: `"7494084364488967268"` (TikTok Shop ID chính thức)
- Storage: `Shop.platformShopId` (string, @unique)

**VẤN ĐỀ:**
```
IF Apify.shopId === EchoTik.seller_id
  → Cùng ID → CONFLICT (platformShopId @unique)
  → Cần source tracking để không ghi đè
  
IF Apify.shopId ≠ EchoTik.seller_id
  → Khác ID → 2 record khác nhau
  → Cần mapping/deduplication
```

**STATUS:** ⚠️ **KHÔNG GỘP TỰ ĐỘNG - CẦN XÁC MINH**

---

### 1.2 Doanh Số & GMV

#### A. Apify cung cấp (từ ProductSnapshot)
```typescript
ProductSnapshot {
  soldCountTotal: BigInt        // Tổng lượt bán
  gmvTotal: Decimal(20,2)       // GMV ước tính
  gmv1d, gmv7d, gmv30d, gmv90d  // GMV theo kỳ
  playCount, diggCount, ...     // Video engagement
  source: 'apify'               // Từ Apify scraper
}
```

#### B. EchoTik cung cấp (từ /seller/list)

**Dữ liệu thực tế từ 10 shops:**

```json
{
  "seller_id": "7494088028217378084",
  "seller_name": "Anxinji",
  
  // ─── Sales/GMV fields (CẤU TRÚC RỖ RÀNG) ───
  "total_sale_gmv_amt": 1106427.86,         // Tổng GMV (lifetime?)
  "total_sale_gmv_1d_amt": 0,
  "total_sale_gmv_7d_amt": 0,
  "total_sale_gmv_30d_amt": 0,              // Nhưng 0?
  "total_sale_gmv_90d_amt": 0,              // Nhưng 0?
  "total_sale_cnt": 203156,                 // Tổng orders/sales
  "total_sale_1d_cnt": 0,
  "total_sale_7d_cnt": 0,
  "total_sale_30d_cnt": 0,
  "total_sale_90d_cnt": 0,
  
  // ─── MYSTERY: IFL fields ───
  "total_ifl_cnt": 694,
  "total_ifl_1d_cnt": 0,
  "total_ifl_7d_cnt": 0,
  "total_ifl_30d_cnt": 0,                   // 0, nhưng total=694?
  "total_ifl_90d_cnt": 0,
  
  // ─── Rating/Quality ───
  "rating": 4.4,
  "review_count": 10809,
  "response_rate": 0.6032,
  "delivery_rate": 0.9333,
  "positive_feedback_rate": null
}
```

**MÂUTHUẪN CẦN GIẢI QUYẾT:**

| Shop | GMV amt | GMV 30d | GMV 90d | Status |
|---|---|---|---|---|
| Anxinji (top) | 1,106,427.86 | 0 | 0 | Lạ: tổng > kỳ |
| Hải Anh Lee (bottom) | 9.27 | 0 | 0 | Quá nhỏ: USD? % margin? |

**KẾT LUẬN:**
- ❌ **KHÔNG ánh xạ trực tiếp** `total_sale_gmv_amt` → `ShopRevenueSnapshot.gmvTotal`
- ❌ **KHÔNG dùng `total_ifl_*_cnt`** khi chưa xác minh ý nghĩa
- ✅ **LƯU VÀO JSON `echotikMetadata`** cho tracking
- ⏳ **CẦN XÁC MINH TÀI LIỆU ECHOTIK** về unit tiền tệ, định nghĩa IFL

---

### 1.3 Rating & Quality Metrics

**Apify:** Không cung cấp response_rate, delivery_rate

**EchoTik:** Cung cấp đầy đủ
- `rating` (0-5 scale) → `Shop.ratingScore`
- `review_count` → `Shop.ratingCount`
- `response_rate` (0-1) → `echotikMetadata.responseRate` (JSON)
- `delivery_rate` (0-1) → `echotikMetadata.deliveryRate` (JSON)
- `positive_feedback_rate` → `echotikMetadata.positiveFeedbackRate` (JSON)

**MAPPING:**
```
✅ rating → Shop.ratingScore
✅ review_count → Shop.ratingCount
⚠️ response_rate, delivery_rate → JSON (EchoTik-specific, no Apify equivalent)
```

---

### 1.4 Creator & Affiliate Data

**Apify:**
- ✅ Trích xuất creator từ video author
- ✅ Ghi nhận role (CREATOR | AFFILIATE)
- ✅ Lưu ProductCreator (product × creator link)
- ✅ Lưu CreatorShop (affiliate × shop link)
- ✅ Tạo CreatorSnapshot theo ngày

**EchoTik:**
- ❌ **KHÔNG CÓ CREATOR ENDPOINT**
- ❌ **CHỈ CÓ SHOP-LEVEL METRICS**
- ❌ Không trả creator data, affiliate list, hay product-creator relationship
- ❌ `/seller/list` response không chứa affiliated creators

**CONSTRAINT:** 
```
EchoTik API hiện tại chỉ hỗ trợ:
✅ /api/v3/echotik/seller/list
✅ /api/v3/echotik/product/list
✅ /api/v3/echotik/product/trend
✅ /api/v3/echotik/category/l1
✅ /api/v3/echotik/category/l2

❌ /api/v3/echotik/creator/*        (NOT FOUND)
❌ /api/v3/echotik/affiliate/*       (NOT FOUND)
❌ /api/v3/echotik/seller/{id}/affiliates  (NOT FOUND)
❌ /api/v3/echotik/*/ranking         (NOT FOUND)
```

---

## II. CONFLICT RESOLUTION STRATEGY

### Nguyên tắc cốt lõi
```
1. Không tự động gộp khi chưa xác minh
2. Không xóa hoặc ghi đè dữ liệu của nguồn khác
3. Lưu rõ ràng nguồn gốc dữ liệu
4. Cho phép cùng entity từ 2 nguồn → kết hợp hoặc đặc biệt hóa
```

### 2.1 Khi gặp cùng `platformShopId`

**Scenario:**
```
Apify scraper:
  Shop { platformShopId: "7494088028217378084", name: "Anxinji", source: "apify" }
  
EchoTik API:
  Shop { platformShopId: "7494088028217378084", seller_id: "7494088028217378084", name: "Anxinji", ... }
```

**Quyết định (quy tắc):**

#### Option 1: MERGE (source="hybrid", kết hợp dữ liệu)
```typescript
IF platformShopId exists AND source exists:
  
  CASE Apify ONLY:
    → Keep as source="apify"
    → Keep Apify-provided fields (username, avatarUrl, shopUrl, followerCount)
  
  CASE EchoTik ONLY:
    → Create new with source="echotik"
    → Store EchoTik-specific metadata (response_rate, delivery_rate, etc.)
  
  CASE Both match same ID:
    → Create ONE record with source="hybrid"
    → Apify fields: name, username, avatarUrl, shopUrl, followerCount (social)
    → EchoTik fields: ratingScore, ratingCount, productCount, echotikMetadata
    → Create SEPARATE ShopRevenueSnapshot for each source
    → When querying: SELECT COALESCE(echotik_gmv, apify_gmv) or merge both
```

#### Option 2: KEEP SEPARATE (cho phép duplicate per source)
```typescript
// Thay đổi Shop model:
@@unique([platformShopId, source])  // Cho phép cùng ID từ 2 source

// Example:
Shop { platformShopId: "123", source: "apify", ... }
Shop { platformShopId: "123", source: "echotik", ... }

// Query logic:
SELECT * FROM Shop WHERE platformShopId = "123"
  → Trả về 2 rows, application logic để merge/pick
```

**KHUYẾN NGHỊ:** **Option 1 (MERGE) + separate snapshots**
- 1 Shop record với tất cả dữ liệu kết hợp
- Snapshot riêng per source để track history
- Query simplicity
- Conflict resolution: prioritize source dựa vào field

---

### 2.2 Field Priority khi cùng ID

**Khi source="hybrid":**

```typescript
// Apify-priority fields (social engagement)
Shop.name = Apify value (more frequent update)
Shop.username = Apify value (video author username)
Shop.avatarUrl = Apify value (profile picture)
Shop.shopUrl = Apify value (URL)
Shop.followerCount = MAX(Apify, EchoTik)  // Trend

// EchoTik-priority fields (shop official metrics)
Shop.ratingScore = EchoTik value (official shop rating)
Shop.ratingCount = EchoTik value (official review count)
Shop.productCount = MAX(Apify total_product_cnt, EchoTik total_crawl_product_cnt)

// Metadata (source-specific)
Shop.echotikMetadata = {
  response_rate, delivery_rate, positive_feedback_rate,
  shop_type, sec_uid, category_ids, from_flag, sales_flag
}
Shop.apifyMetadata = {  // Future: if needed
  actor_id, run_id, crawl_timestamp
}
```

---

### 2.3 Product Mapping

**Apify → Product:**
- `item.productId` → `Product.platformProductId`
- `item.title` → `Product.title`
- `item.price`, `item.priceMax` → `Product.minPrice`, `Product.maxPrice`
- `item.shopId` → FK `Product.shopId` (via Shop join)

**EchoTik → Product:**
- `product_id` → `Product.platformProductId`
- `title` → `Product.title`
- `price` fields → `Product.minPrice`, `Product.maxPrice`
- `seller_id` → FK `Product.shopId` (via Shop lookup)

**COLLISION CHECK:**
```sql
SELECT COUNT(*) FROM Product 
WHERE platformProductId IN (
  SELECT product_id FROM echotik_product_list
)
-- If > 0: products exist from Apify, need dedup strategy
```

**STRATEGY:**
- ✅ **MATCH if `platformProductId` same** → UPDATE if newer, KEEP if older
- ⏳ **CẦN VERIFY:** Does Apify use same product_id as EchoTik?

---

### 2.4 Category Mapping

**Hierarchy:**
```
Category (L1)
├── SubCategory (L2)
└── ThirdLevelCategory (L3)
```

**EchoTik provides:**
- `/api/v3/echotik/category/l1?language=vi-VN`
- `/api/v3/echotik/category/l2?language=vi-VN&parent_id=<L1_ID>`
- **NO L3 endpoint** (but data may include `category_l3_id` field)

**Apify provides:**
- `item.categories[]` (flat list of category names)
- NO hierarchical structure

**MAPPING:**
```
EchoTik:
  category_id (L1) → Category.name, slug
  category_l2_id (L2) → SubCategory.name, slug
  category_l3_id (L3) → ThirdLevelCategory.name, slug

Apify:
  categories[0] → Category (flat mapping)
  NO subcategory data
  
DEDUP:
  @@unique([name]) per table level
  Upsert on slug if duplicate name different language
```

---

## III. DESIGN: SOURCE TRACKING

### 3.1 Schema Changes Required

**MIGRATION 1: Add source tracking**

```prisma
model Shop {
  id             Int     @id @default(autoincrement())
  platformShopId String              // TikTok Shop ID
  source         String  @default("apify")  // "apify" | "echotik" | "hybrid"
  
  name           String
  username       String?
  avatarUrl      String?
  bannerUrl      String?
  shopUrl        String?
  
  region         String  @default("VN")
  followerCount  BigInt?
  productCount   Int     @default(0)
  soldCountTotal BigInt?
  gmvTotal       Decimal? @db.Decimal(20,2)
  avgOrderValue  Decimal? @db.Decimal(20,2)
  ratingScore    Decimal? @db.Decimal(4,2)
  ratingCount    BigInt?
  
  // Source-specific metadata
  echotikMetadata Json?  // { response_rate, delivery_rate, shop_type, sec_uid, ... }
  apifyMetadata   Json?  // { actor_id, run_id, ... } (future)
  
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  
  productShops     ProductShop[]
  creatorShops     CreatorShop[]
  revenueSnapshots ShopRevenueSnapshot[]
  products         Product[]
  
  // CONSTRAINT CHANGE: Allow same ID from different sources
  @@unique([platformShopId, source])
  @@index([source])
  @@index([region, name, source])
}

model ShopRevenueSnapshot {
  id BigInt @id @default(autoincrement())
  
  shopId      Int
  source      String          // "apify" | "echotik" | "hybrid"
  scrapeJobId Int?
  
  capturedAt  DateTime @default(now())
  bucketDate  DateTime @db.Date
  
  // Standard fields (both sources)
  gmvTotal    Decimal? @db.Decimal(20,2)
  soldCountTotal BigInt?
  productCount Int?
  avgOrderValue Decimal? @db.Decimal(20,2)
  ratingScore Decimal? @db.Decimal(4,2)
  ratingCount BigInt?
  
  // Apify-specific
  gmvVideo    Decimal? @db.Decimal(20,2)
  gmvLive     Decimal? @db.Decimal(20,2)
  gmvCart     Decimal? @db.Decimal(20,2)
  gmvProductCard Decimal? @db.Decimal(20,2)
  
  // EchoTik-specific (pending verification)
  echotikRawData Json?  // { total_sale_gmv_*_amt, total_ifl_*_cnt, ... }
  
  isEstimated Boolean @default(true)
  rawData     Json?
  
  shop      Shop       @relation(fields: [shopId], references: [id], onDelete: Cascade)
  scrapeJob ScrapeJob? @relation(fields: [scrapeJobId], references: [id])
  
  @@unique([shopId, source, bucketDate])
  @@index([shopId, capturedAt, source])
}

model Creator {
  id                Int     @id @default(autoincrement())
  platformCreatorId String  @unique
  
  source String @default("apify")  // "apify" | "echotik" (if future endpoint)
  
  username          String?
  displayName       String
  avatarUrl         String?
  bio               String?
  role              CreatorRole @default(CREATOR)
  
  region String @default("VN")
  
  followerCount  BigInt?
  engagementRate Decimal? @db.Decimal(8,4)
  gmvTotal       Decimal? @db.Decimal(20,2)
  soldCount      BigInt?
  videoCount     Int?
  
  echotikMetadata Json?  // If future EchoTik creator endpoint
  
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  
  productLinks ProductCreator[]
  shopLinks    CreatorShop[]
  snapshots    CreatorSnapshot[]
  
  @@index([source])
}

model CreatorSnapshot {
  id BigInt @id @default(autoincrement())
  
  creatorId   Int
  source      String   // "apify" | "echotik"
  scrapeJobId Int?
  
  capturedAt  DateTime @default(now())
  bucketDate  DateTime @db.Date
  
  followerCount  BigInt?
  engagementRate Decimal? @db.Decimal(8,4)
  gmvTotal       Decimal? @db.Decimal(20,2)
  soldCount      BigInt?
  videoCount     Int?
  
  isEstimated Boolean @default(false)
  rawData     Json?
  
  creator   Creator    @relation(fields: [creatorId], references: [id], onDelete: Cascade)
  scrapeJob ScrapeJob? @relation(fields: [scrapeJobId], references: [id])
  
  @@unique([creatorId, source, bucketDate])
  @@index([creatorId, capturedAt, source])
}

model Product {
  id                Int     @id @default(autoincrement())
  platformProductId String  @unique
  
  source String @default("apify")  // "apify" | "echotik"
  
  title             String
  description       String?
  imageUrl          String?
  productUrl        String?
  category          String?
  subCategory       String?
  
  shopId Int?
  shop   Shop? @relation(fields: [shopId], references: [id], onDelete: SetNull)
  
  currency String @default("VND")
  region   String @default("VN")
  
  minPrice          Decimal? @db.Decimal(18,2)
  maxPrice          Decimal? @db.Decimal(18,2)
  minOriginalPrice  Decimal? @db.Decimal(18,2)
  maxOriginalPrice  Decimal? @db.Decimal(18,2)
  variantCount      Int      @default(0)
  
  sellerCount Int      @default(0)
  soldCount   BigInt?
  avgPrice    Decimal? @db.Decimal(18,2)
  
  stockTotal  Int?
  ratingScore Decimal? @db.Decimal(4,2)
  ratingCount BigInt?
  isAvailable Boolean  @default(true)
  
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  
  productShops ProductShop[]
  snapshots    ProductSnapshot[]
  variants     ProductVariant[]
  creatorLinks ProductCreator[]
  
  @@index([source])
}
```

**SQL Migrations:**

```sql
-- M1: Add source columns
ALTER TABLE Shop ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE Shop ADD COLUMN echotikMetadata JSONB;
ALTER TABLE Shop DROP CONSTRAINT Shop_platformShopId_key;
ALTER TABLE Shop ADD CONSTRAINT idx_shop_platformshopid_source UNIQUE (platformShopId, source);

ALTER TABLE Creator ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE Creator ADD COLUMN echotikMetadata JSONB;

ALTER TABLE Product ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

ALTER TABLE ShopRevenueSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE ShopRevenueSnapshot ADD COLUMN echotikRawData JSONB;
ALTER TABLE ShopRevenueSnapshot DROP CONSTRAINT ShopRevenueSnapshot_shopId_source_bucketDate_key;
ALTER TABLE ShopRevenueSnapshot ADD CONSTRAINT idx_shop_revenue_unique 
  UNIQUE (shopId, source, bucketDate);

ALTER TABLE CreatorSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE CreatorSnapshot DROP CONSTRAINT CreatorSnapshot_creatorId_source_bucketDate_key;
ALTER TABLE CreatorSnapshot ADD CONSTRAINT idx_creator_snapshot_unique 
  UNIQUE (creatorId, source, bucketDate);

-- Indexes
CREATE INDEX idx_shop_source ON Shop(source);
CREATE INDEX idx_shop_revenue_source ON ShopRevenueSnapshot(shopId, source, capturedAt);
CREATE INDEX idx_creator_source ON Creator(source);
CREATE INDEX idx_product_source ON Product(source);
```

---

## IV. MAPPING CHÍNH XÁC

### 4.1 Shop Mapping

| EchoTik Field | Prisma Field | Type | Unit | Status | Notes |
|---|---|---|---|---|---|
| `seller_id` | `platformShopId` | string | N/A | ✅ Ready | TikTok unique ID |
| `seller_name` | `name` | string | N/A | ✅ Ready | Required |
| `seller_link` | `shopUrl` | string | URL | ✅ Ready | Extract from `/store/[name]/[id]` |
| `region` | `region` | string | "VN" | ✅ Ready | Hardcoded VN |
| `followers_count` | `followerCount` | BigInt | count | ✅ Ready | May be null |
| `rating` | `ratingScore` | Decimal(4,2) | 0-5 | ✅ Ready | Official shop rating |
| `review_count` | `ratingCount` | BigInt | count | ✅ Ready | Official review count |
| `total_crawl_product_cnt` | `productCount` | Int | count | ✅ Ready | EchoTik crawled products |
| `cover_url` | `bannerUrl` | string | URL | ✅ Ready | Shop banner image |
| `sec_uid` | `echotikMetadata.secUid` | string (JSON) | ID | ✅ Ready | Store in JSON |
| `shop_type` | `echotikMetadata.shopType` | int (JSON) | flag | ✅ Ready | 0=personal, 1=official |
| `response_rate` | `echotikMetadata.responseRate` | decimal (JSON) | 0-1 | ✅ Ready | Store in JSON |
| `delivery_rate` | `echotikMetadata.deliveryRate` | decimal (JSON) | 0-1 | ✅ Ready | Store in JSON |
| `positive_feedback_rate` | `echotikMetadata.positiveFeedbackRate` | decimal (JSON) | 0-1 | ✅ Ready | Store in JSON |
| `category_id` | `primaryCategoryId` (FK) | int | ID | ⏳ Future | Link to Category table |
| `category_l2_id` | (JSON) | int | ID | ⏳ Future | Store in metadata |
| `category_l3_id` | (JSON) | int | ID | ⏳ Future | Store in metadata |
| `total_sale_gmv_amt` | `echotikRawData.totalGmvAmt` (JSON) | decimal (JSON) | **UNVERIFIED** | ❌ Hold | Unit not confirmed |
| `total_sale_gmv_*_amt` | `echotikRawData.gmvByPeriod` (JSON) | object (JSON) | **UNVERIFIED** | ❌ Hold | Period data unclear |
| `total_sale_*_cnt` | `echotikRawData.salesCntByPeriod` (JSON) | object (JSON) | count | ⏳ Pending | Definition TBD |
| `total_ifl_*_cnt` | `echotikRawData.iflCntByPeriod` (JSON) | object (JSON) | **UNKNOWN** | ❌ Hold | Acronym undefined |

### 4.2 Product Mapping

| EchoTik Field | Prisma Field | Type | Status |
|---|---|---|---|
| `product_id` | `platformProductId` | string | ✅ Ready |
| `title` | `title` | string | ✅ Ready |
| `description` | `description` | string | ✅ Ready |
| `price` range | `minPrice`, `maxPrice` | Decimal(18,2) | ⏳ Verify format |
| `rating` | `ratingScore` | Decimal(4,2) | ✅ Ready |
| `sold_count` | `soldCount` | BigInt | ✅ Ready |
| `seller_id` | `shopId` (via FK) | int | ⏳ Verify shop match |

### 4.3 Category Mapping

| EchoTik Field | Prisma Field | Type | Status |
|---|---|---|---|
| `categoryId` (L1) | `Category.name` | string | ✅ Ready |
| `categoryId` (L1) | `Category.slug` | string | ✅ Ready |
| `parentId` (L2) | `SubCategory.name` | string | ✅ Ready |
| `categoryId` (L2) | `SubCategory.slug` | string | ✅ Ready |
| `categoryId` (L3) | `ThirdLevelCategory.name` | string | ⏳ No L3 endpoint |

---

## V. PHẠM VI PHASE 1 & PHASE 2

### PHASE 1: Foundation (Ready to implement)

**Entities:**
- ✅ **Shop/Seller** (with source tracking)
- ✅ **Product** (with source tracking)
- ✅ **Category L1, L2** (no source needed - reference data)

**Endpoints:**
```
✅ GET /api/v3/echotik/seller/list
✅ GET /api/v3/echotik/product/list
✅ GET /api/v3/echotik/product/trend (basic support)
✅ GET /api/v3/echotik/category/l1
✅ GET /api/v3/echotik/category/l2
```

**Initial Tasks:**
1. Import 10 shops into Shop table (source="echotik")
2. Sync products (source="echotik")
3. Sync categories (reference data, no source)
4. Create snapshots for shop revenue (source="echotik")
5. Handle Apify+EchoTik conflicts (source="hybrid" merging)

**Database:**
- Schema migrations (add source fields)
- Ingestion logic (shop, product, category)
- Conflict resolution for same platformShopId

**NOT Phase 1:**
- Creator/Affiliate detailed sync
- Video content from EchoTik (no endpoint)
- Rankings aggregation (Phase 2)

---

### PHASE 2: Extended Data (Depends on EchoTik endpoint availability)

**Waiting for:**
- ❓ Creator/Affiliate API endpoint
- ❓ Video/Content API endpoint
- ❓ Shop/Creator Ranking endpoint

**Alternative sources:**
- Apify creative center (for video/creator content)
- Manual ranking aggregation from snapshots

**If EchoTik endpoints NOT available:**
- Use Apify for creator/affiliate/video
- Build hybrid approach (EchoTik shop metrics + Apify creator data)
- Aggregate rankings from snapshots

---

## VI. FILE CẦN TẠO

### A. Ingestion Services

1. **`src/services/echotik/echoTikShopSyncService.ts`**
   - Function: `syncEchoTikShops(page, pageSize)`
   - Logic:
     - Fetch `/seller/list`
     - Normalize to Shop schema
     - Handle collision (Apify vs EchoTik)
     - Create ShopRevenueSnapshot
   - Return: SyncResult { created, updated, skipped, conflicts }

2. **`src/services/echotik/echoTikProductSyncService.ts`**
   - Function: `syncEchoTikProducts(page, pageSize)`
   - Logic:
     - Fetch `/product/list`
     - Normalize to Product schema
     - Link to Shop (via seller_id lookup)
     - Create ProductSnapshot
   - Return: SyncResult

3. **`src/services/echotik/echoTikCategorySyncService.ts`**
   - Function: `syncEchoTikCategories()`
   - Logic:
     - Fetch `/category/l1`
     - For each L1, fetch `/category/l2?parent_id=<L1_ID>`
     - Normalize hierarchy
     - Upsert Category, SubCategory (no source tracking - reference data)
   - Return: SyncResult

4. **`src/services/echotik/echoTikConflictResolver.ts`** (NEW)
   - Class: `EchoTikConflictResolver`
   - Methods:
     - `resolveShopConflict(apifyShop, echotikShop)` → merged Shop
     - `resolveProductConflict(apifyProduct, echotikProduct)` → merged Product
     - `shouldMerge(id1, id2, source1, source2)` → boolean
   - Logic: implement field priority, metadata merge

### B. Normalization/Mapping

5. **`src/services/echotik/echoTikShopNormalizer.ts`** (EXPAND)
   - Enhance existing to handle:
     - EchoTik rating/response_rate/delivery_rate → echotikMetadata
     - Store tất cả fields in rawData (even unverified)
   - Add validation: verify IFL, GMV unit before mapping

6. **`src/services/echotik/echoTikProductNormalizer.ts`** (EXPAND)
   - Map product_id → platformProductId
   - Handle seller_id → shopId lookup

7. **`src/services/echotik/echoTikCategoryNormalizer.ts`** (NEW)
   - Normalize L1, L2 responses
   - Build hierarchy structure

### C. Sync Orchestration

8. **`src/scripts/syncEchoTikPhase1.ts`** (MASTER SCRIPT)
   - Sequential sync:
     1. syncEchoTikCategories()
     2. syncEchoTikShops()
     3. syncEchoTikProducts()
   - Transaction handling
   - Quota tracking
   - Result reporting

9. **`src/scripts/importEchoTikShopsInitial.ts`** (INITIAL 10 SHOPS)
   - Import 10 shops from `data/echotik/seller-list-2026-11-05T19-41-35-084Z.json`
   - Create ScrapeJob
   - Run `ingestEchoTikShops()` existing function
   - Create ShopRevenueSnapshot for each
   - Report: created/skipped/conflicts with reasons

### D. Controllers & Routes

10. **`src/controllers/echoTikSyncController.ts`** (EXPAND)
    - Endpoint: `POST /api/admin/echotik/sync-phase1`
    - Endpoint: `POST /api/admin/echotik/sync-products`
    - Endpoint: `POST /api/admin/echotik/sync-categories`
    - Endpoint: `GET /api/admin/echotik/sync-status`
    - Tracking: ScrapeJob for each sync

### E. Testing & Verification

11. **`src/scripts/verifyEchoTikConflicts.ts`** (QA)
    - Check for duplicate platformShopId (Apify + EchoTik)
    - Report conflict statistics
    - Suggest resolution strategy

12. **`src/scripts/testEchoTikMapping.ts`** (UNIT VERIFICATION)
    - Test normalizers with sample data
    - Verify field mappings
    - Validate against Prisma schema

---

## VII. FILE CẦN SỬA

### A. Database Schema

1. **`prisma/schema.prisma`**
   - Add `source` field to: Shop, Creator, Product, ShopRevenueSnapshot, CreatorSnapshot
   - Add `echotikMetadata` JSON to: Shop, Creator
   - Change constraints: `@@unique([platformShopId, source])` instead of `@unique`
   - Add indexes for source tracking
   - (See Migration 1 above for SQL)

### B. Ingestion Logic

2. **`src/services/scraper/ingestionService.ts`**
   - Modify `persistRecord()` to accept source parameter
   - Update Shop.upsert logic to handle source conflicts
   - Store source in ShopRevenueSnapshot
   - Pass source through CreatorSnapshot, ProductSnapshot

3. **`src/services/echotik/echoTikShopIngestionService.ts`**
   - Current: ingests 10 shops at a time
   - Update: handle conflict resolution (Apify vs EchoTik)
   - Store source="echotik"
   - Create ShopRevenueSnapshot with echotikRawData

4. **`src/services/echotik/echoTikNormalizer.ts`**
   - Add validation for IFL, GMV fields (log warnings if undefined)
   - Store ALL raw fields in echotikMetadata JSON
   - Do NOT assume unit conversions

### C. API Response Layer

5. **`src/modules/shopCommerce/shopService.ts`**
   - When fetching Shop for detail page:
     - Join with BOTH Apify and EchoTik data (source filter)
     - Return source field in response
     - Merge metadata when source="hybrid"

6. **`src/controllers/analyticsController.ts`**
   - Update Shop listing responses to include source
   - Filter by source if requested (`?source=apify|echotik|all`)
   - Report conflict count (shops with both sources)

### D. Configuration & Docs

7. **`.env.example`**
   - Add clear comments for EchoTik fields
   - Document IFL, GMV meaning (pending verification)
   - Example values

---

## VIII. MIGRATION PLAN

### Step 1: Prepare (Non-breaking)
```sql
-- Add new columns with defaults
ALTER TABLE Shop ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE Shop ADD COLUMN echotikMetadata JSONB;

ALTER TABLE Product ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

ALTER TABLE Creator ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

ALTER TABLE ShopRevenueSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;
ALTER TABLE ShopRevenueSnapshot ADD COLUMN echotikRawData JSONB;

ALTER TABLE CreatorSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify' NOT NULL;

-- Create new indexes
CREATE INDEX idx_shop_source ON Shop(source);
CREATE INDEX idx_shop_source_id ON Shop(platformShopId, source);
```

### Step 2: Constraint Migration (requires exclusivity)
```sql
-- Remove old constraint
ALTER TABLE Shop DROP CONSTRAINT Shop_platformShopId_key;

-- Add new unique constraint
ALTER TABLE Shop ADD CONSTRAINT idx_shop_platformshopid_source UNIQUE (platformShopId, source);

-- Similar for other tables...
```

### Step 3: Code Deployment
- Deploy schema changes
- Deploy ingestion services
- Deploy conflict resolver
- Deploy API updates

### Step 4: Data Sync
- Run `syncEchoTikPhase1` script
- Monitor conflicts, log decisions
- Verify data integrity

---

## IX. BACKEND API RESPONSE UPDATES

### Current API responses (analyticsController.ts)

**GET /api/products** needs:
```typescript
interface ProductListItem {
  // ... existing fields ...
  source?: string;  // "apify" | "echotik" | "hybrid"
  gmv: number;      // FROM WHERE? ProductSnapshot.gmvTotal or calculated?
  sales: number;    // FROM WHERE? soldCountTotal or total_sale_cnt?
}
```

**GET /api/shops** needs:
```typescript
interface ShopListItem {
  // ... existing fields ...
  source?: string;       // "apify" | "echotik" | "hybrid"
  totalGmv: number;      // MERGE both sources or prefer one?
  totalSales: number;    // MERGE or prefer?
  ratingScore: number;   // FROM EchoTik if source="echotik"
}
```

**GET /api/shops/:id** needs:
```typescript
interface ShopDetail {
  shop: ShopListItem & {
    echotikMetadata?: {
      responseRate?: number;
      deliveryRate?: number;
      shopType?: number;
    };
  };
  revenueSources: {
    source: string;         // Track source
    gmvVideo?: number;      // Apify only
    gmvLive?: number;       // Apify only
    gmvCart?: number;       // Apify only
    gmvTotal?: number;      // Both
  }[];
}
```

**DECISION POINT:**
- How to rank/display when data from both sources?
- Take MAX GMV? MERGE? Show separate?
- Display source indicator in UI?

---

## X. RỦI RO & GIẢM THIỂU

| Rủi ro | Mức độ | Giảm thiểu |
|---|---|---|
| **ID collision** | 🔴 Critical | Source tracking + unique(platformShopId, source) |
| **Data ghi đè** | 🔴 Critical | Never update existing; only insert with source |
| **GMV unit confusion** | 🟠 High | Store in JSON; do NOT calculate cross-currency |
| **IFL definition unclear** | 🟠 High | Store raw data; log warnings if undefined |
| **Creator endpoint missing** | 🟠 High | Document as Phase 2; use Apify fallback |
| **Quota exhaustion** | 🟡 Medium | Track quota per request; alert at 80% |
| **Snapshot drift** | 🟡 Medium | Cron job daily sync; alert if data > 3 days old |
| **Apify conflict** | 🟡 Medium | Verify platformShopId match; test on staging |

---

## XI. TESTING STRATEGY

### Unit Tests
```typescript
// Test normalizers
test('echoTikShopNormalizer: maps seller_id → platformShopId')
test('echoTikProductNormalizer: handles price range')
test('echoTikCategoryNormalizer: builds hierarchy')

// Test conflict resolver
test('ConflictResolver: Apify + EchoTik same ID → merge')
test('ConflictResolver: Apify only → keep as apify')
test('ConflictResolver: EchoTik only → create as echotik')

// Test validators
test('Validator: IFL field unknown → log warning, store in JSON')
test('Validator: GMV unit unverified → store raw, do NOT convert')
```

### Integration Tests
```typescript
// Test sync operations
test('syncEchoTikShops: creates 10 shops with source="echotik"')
test('syncEchoTikProducts: links to shops via seller_id')
test('syncEchoTikCategories: builds L1→L2 hierarchy')

// Test conflict handling
test('Conflict: same shop ID from Apify + EchoTik → merged record')
test('Conflict: snapshot created for each source separately')

// Test API responses
test('GET /api/shops: returns source field')
test('GET /api/shops: filters by source if requested')
```

### Data Validation
```
✅ 10 shops imported
✅ platformShopId unique per source
✅ No data loss from Apify
✅ ShopRevenueSnapshot created for echotik source
✅ All required fields mapped
✅ echotikMetadata populated for EchoTik-only fields
✅ rawData stored for audit trail
```

---

## XII. SUMMARY: TIẾP THEO

### ✅ ĐÃ HỌC ĐƯỢC
1. Apify dùng `item.shopId` hoặc `item.sellerId` (format chưa xác minh)
2. EchoTik dùng `seller_id` (string numeric)
3. Apify cung cấp creator/affiliate data (product × creator link)
4. EchoTik KHÔNG cung cấp creator endpoint
5. EchoTik doanh số fields chưa xác minh (unit, định nghĩa)
6. Backend API cần source tracking
7. Database constraint conflict `@unique` cần thay đổi

### ⚠️ CẦN XÁC MINH (TRƯỚC PHASE 1)
1. **Apify seller_id format & match:** Sample Apify data để so sánh với EchoTik
2. **GMV unit & IFL definition:** Tài liệu EchoTik chính thức
3. **Creator endpoint check:** Xác nhận EchoTik không có endpoint creator/affiliate
4. **Scope confirm:** Phase 1 = Shop+Product+Category? Phase 2 = Creator+Video?

### 📋 BÁOCÁO ĐẦY ĐỦ CHỨA
- Điểm khác biệt Apify vs EchoTik (all fields)
- Conflict resolution strategy (merge vs separate)
- Schema changes (migrations)
- File cần tạo (8 files)
- File cần sửa (7 files)
- API response updates
- Testing plan
- Risk mitigation

---

## DỪNG ĐỢI DỰ ÁN

**Báo cáo này lưu tại:**
`D:\tiktok-scraper-ts\TECHNICAL_IMPLEMENTATION_REPORT.md`

**Vui lòng duyệt:**
1. ✅ Conflict resolution strategy (Option 1: MERGE recommended)
2. ✅ Mapping chinh xác (hold IFL/GMV khi chưa verified)
3. ✅ Source tracking design (@@unique([platformShopId, source]))
4. ✅ Phase 1 scope (Shop+Product+Category)
5. ✅ File list (15 files tạo/sửa)

**Khi xác nhận:**
```
OK TRIỂN KHAI PHASE 1
```

Tôi sẽ:
- Tạo migration scripts
- Tạo ingestion services
- Tạo sync orchestration
- Tạo conflict resolver
- Tạo test plan
- Import 10 shops initial

