# PHÂN TÍCH CHI TIẾT ECHOTIK - 5 VẤN ĐỀ QUAN TRỌNG

**Ngày phân tích:** 2026-11-06  
**Phạm vi:** Chỉ phân tích, KHÔNG CODE, KHÔNG API, KHÔNG MIGRATION

---

## VẤN ĐỀ 1: APIFY SELLER_ID MATCH ECHOTIK?

### 1.1 Trích xuất Apify Shop ID từ `shopNormalizer.ts:239-244`

```typescript
const platformShopId = pickText(
  seller.sellerId,           // Priority 1: seller object field
  item.shop_id,              // Priority 2: direct field
  item.sellerId,             // Priority 3: alternative direct field
  extractShopIdFromUrl(shopUrl),  // Priority 4: parse from URL
);
```

**Thứ tự ưu tiên:**
1. `seller.sellerId` (từ nested `seller` object)
2. `item.shop_id` (direct field - memo23 actor)
3. `item.sellerId` (alternative)
4. URL parsing: `/store/[name]/(\d+)` hoặc `/store/(\d+)`

### 1.2 Type definition từ `shopScrape.ts:130-139`

```typescript
export interface RawShopSeller {
  sellerId?: string | number;      // ← Apify field
  shopName?: string;
  shopLogoUrl?: string;
  shopUrl?: string;
  followerCount?: number | string;
  shopFollowerCount?: number | string;
  productCount?: number | string;
}
```

### 1.3 EchoTik Seller ID từ JSON response

Từ `data/echotik/seller-list-2026-11-05T19-41-35-084Z.json`:

```json
{
  "seller_id": "7494084364488967268",      // ← EchoTik field (string)
  "seller_name": "Hải Anh Lee",
  "seller_link": "aweme://user/profile/6741637508570727425?sec_uid=...",
  // ... other fields
}
```

### 1.4 So sánh định dạng ID

| Nguồn | Field | Kiểu | Ví dụ | Format |
|---|---|---|---|---|
| Apify | `seller.sellerId` | string \| number | (không có mẫu) | TBD |
| EchoTik | `seller_id` | string | `7494084364488967268` | Numeric string |

### 1.5 KHÓ KHĂN: Apify không có dữ liệu để so sánh

**Vấn đề:** 
- shopNormalizer.ts chỉ định nghĩa cách trích xuất, **không có example data từ Apify**
- Loại ID Apify trả về: KHÔNG BIẾT
- Có match với EchoTik `seller_id` không: **CẦN XÁC MINH**

**Kết luận:**
- ⚠️ **NẾU Apify trả về `seller_id` === EchoTik `seller_id`** → Có thể ghép được bằng `platformShopId`
- ⚠️ **NẾU Apify trả về `shop_id` khác format** → Không thể ghép trực tiếp, cần mapping table

**Bằng chứng cần:**
1. Sample Apify response với `seller.sellerId` value
2. So sánh giá trị với EchoTik `seller_id` từ file JSON

**Status:** ❓ KHÔNG XÁC MINH

---

## VẤN ĐỀ 2: ECHOTIK DOANH SỐ - NGHĨA & ĐƠN VỊ

### 2.1 Field doanh số từ EchoTik JSON

Từ 10 shops thực tế:

```json
{
  "total_sale_gmv_amt": 9.27,           // Tổng GMV
  "total_sale_gmv_1d_amt": 0,           // GMV 1 ngày
  "total_sale_gmv_7d_amt": 0,           // GMV 7 ngày
  "total_sale_gmv_30d_amt": 0,          // GMV 30 ngày
  "total_sale_gmv_90d_amt": 0,          // GMV 90 ngày
  
  "total_sale_cnt": 1,                  // Tổng số đơn / lượt bán?
  "total_sale_1d_cnt": 0,               // Số đơn 1 ngày?
  "total_sale_7d_cnt": 0,               // Số đơn 7 ngày?
  "total_sale_30d_cnt": 0,              // Số đơn 30 ngày?
  "total_sale_90d_cnt": 0,              // Số đơn 90 ngày?
  
  "total_ifl_1d_cnt": 0,                // ??? IFL = ?
  "total_ifl_7d_cnt": 0,                // ???
  "total_ifl_30d_cnt": 0,               // ???
  "total_ifl_90d_cnt": 0,               // ???
  "total_ifl_cnt": 1,                   // ???
}
```

### 2.2 Phân tích từ dữ liệu thực tế

**Shop "Anxinji" (top seller):**
```
total_sale_gmv_amt: 1,106,427.86        (USD? VND? CNY?)
total_sale_gmv_30d_amt: 1,089,900       (30 ngày gần nhất)
total_sale_gmv_90d_amt: 1,106,427.86    (90 ngày = tổng toàn bộ)
total_sale_cnt: 203,156                 (Số order hay lượt?)
total_sale_30d_cnt: 203,156             (?)
total_ifl_30d_cnt: 0                    (Nhưng ifl_cnt = 694)
```

**Shop "Hải Anh Lee" (bottom seller):**
```
total_sale_gmv_amt: 9.27                (Quá nhỏ - có phải % hay biên??)
total_sale_cnt: 1                       (1 đơn)
total_ifl_cnt: 1
```

### 2.3 KHÓ KHĂN: Các field không có tài liệu

| Field | Định nghĩa | Đơn vị | Tính chất |
|---|---|---|---|
| `total_sale_gmv_*_amt` | Gross Merchandise Value? | USD / VND / CNY? | **CẦN XÁC MINH** |
| `total_sale_*_cnt` | Số order hay số lượt bán? | Count | **CẦN XÁC MINH** |
| `total_ifl_*_cnt` | IFL = Influencer Flow? In-feed Listing? | Count | **CẦN XÁC MINH** |

### 2.4 Bằng chứng từ code hiện tại

`echoTikShopIngestionService.ts` không map các field doanh số:

```typescript
// Chỉ lưu những field này:
platformShopId,
name,
shopUrl,
region,
followerCount,
ratingScore,
ratingCount,
productCount
// ❌ KHÔNG CÓ gmvTotal, soldCountTotal, ifl_cnt
```

### 2.5 Kết luận

**Status:** ❌ **KHÔNG XÁC MINH - CẦN TÀI LIỆU CHÍNH THỨC ECHOTIK**

**Những điều chưa rõ:**
1. `total_sale_gmv_amt` đơn vị tiền là gì?
2. `total_sale_*_cnt` vs `total_ifl_*_cnt` khác nhau gì?
3. Tại sao "Anxinji" có `total_ifl_30d_cnt=0` nhưng `total_ifl_cnt=694`?
4. Tại sao "Hải Anh Lee" có `total_sale_gmv_amt=9.27` (liệu có phải 9.27 USD hay 9.27 triệu VND)?

**Yêu cầu:**
- Xác minh tài liệu EchoTik API chính thức
- Xác minh đơn vị tiền tệ
- Xác minh định nghĩa từng field `total_*_cnt`

---

## VẤN ĐỀ 3: THIẾT KẾ LƯU NGUỒN DỮ LIỆU

### 3.1 Vấn đề hiện tại

Schema `Shop` không có `source` field:

```prisma
model Shop {
  id             Int     @id @default(autoincrement())
  platformShopId String  @unique  // ← Khóa định danh (có thể từ Apify HOẶC EchoTik)
  name           String
  // ... không có source field
}
```

**Rủi ro:**
- Apify & EchoTik cùng dùng `seller_id` → trùng `platformShopId`
- Khi update từ EchoTik, không biết update có ghi đè Apify data không
- Không thể track "dữ liệu này lấy từ nguồn nào"

### 3.2 Giải pháp đề xuất: Thêm `source` field

#### Option A: Thêm `source` vào Shop model (RECOMMENDED)

```prisma
model Shop {
  id             Int     @id @default(autoincrement())
  platformShopId String  @unique  // TikTok Shop ID chính thức
  source         String  @default("apify")  // "apify" | "echotik" | "hybrid"
  name           String
  username       String?
  // ...
  
  // Lưu extra data từ EchoTik
  echotikMetadata Json?  // { sec_uid, shop_type, response_rate, delivery_rate, ... }
  
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  
  @@unique([platformShopId, source])  // Cho phép cùng ID từ 2 nguồn khác
}
```

**Ưu điểm:**
- ✅ Rõ ràng dữ liệu từ nguồn nào
- ✅ Có thể lưu metadata riêng từ từng nguồn
- ✅ Cho phép hybrid: cùng shop từ 2 nguồn = 1 record (source="hybrid")

**Nhược điểm:**
- ⚠️ Cần migration
- ⚠️ Cần update ingestion logic (Apify vs EchoTik)

#### Option B: ShopProvenance table (tracking provenance)

```prisma
model Shop {
  // ... hiện tại
}

model ShopProvenance {
  id          Int       @id @default(autoincrement())
  shopId      Int
  source      String    // "apify" | "echotik"
  sourceId    String    // seller_id từ source
  confidence  Decimal?  // 1.0 = confirmed match, 0.5 = inferred
  lastSeenAt  DateTime  @default(now())
  
  shop        Shop      @relation(fields: [shopId], references: [id])
  
  @@unique([shopId, source])
  @@index([sourceId])
}
```

**Ưu điểm:**
- ✅ Lưu lịch sử tất cả nguồn cho 1 shop
- ✅ Track độ tin cậy của match
- ✅ Không cần thay đổi Shop model

**Nhược điểm:**
- ⚠️ Complex query (join với ShopProvenance)
- ⚠️ Cần migration

#### Option C: Chỉ lưu trong rawData JSON (không recommend)

```prisma
model Shop {
  // ... hiện tại
  rawData Json?  // { source: "apify", apifyRequestId: "...", echotikData: {...} }
}
```

**Ưu điểm:**
- ✅ KHÔNG cần migration
- ✅ Linh hoạt lưu dữ liệu thô

**Nhược điểm:**
- ❌ Không thể query/filter theo source
- ❌ Dữ liệu semi-structured, khó maintain

### 3.3 Khuyến nghị

**Sử dụng Option A (thêm `source` field) vì:**
1. Rõ ràng, structured
2. Có thể index trên `source`
3. Dễ query "shops từ EchoTik" hay "shops từ Apify"
4. Hỗ trợ conflict resolution: khi cùng `platformShopId`, so sánh `source` để quyết định update hay không

### 3.4 Migration dự kiến

```sql
-- 1. Thêm column
ALTER TABLE Shop ADD COLUMN source VARCHAR(50) DEFAULT 'apify';
ALTER TABLE Shop ADD COLUMN echotikMetadata JSONB NULL;

-- 2. Tạo index mới
CREATE UNIQUE INDEX idx_shop_platformshopid_source 
  ON Shop(platformShopId, source);

-- 3. Update constraint (nếu cần)
-- Xóa @unique [platformShopId] cũ, thêm @@unique([platformShopId, source])
```

**Status:** ✅ **ĐỦKHẢ THI - READY DESIGN**

---

## VẤN ĐỀ 4: ECHOTIK REVENUE BREAKDOWN

### 4.1 Kiểm tra EchoTik endpoints hiện có

Từ `echoTikClient.ts`:

```typescript
async getSellerList(pageNum, pageSize, region)     // /api/v3/echotik/seller/list
async getProductList(pageNum, pageSize, region)    // /api/v3/echotik/product/list
async getProductTrend(productId, startDate, endDate, pageNum, pageSize)  // /api/v3/echotik/product/trend
async getCategoryL1(language)                       // /api/v3/echotik/category/l1
async getCategoryL2(parentId, language)             // /api/v3/echotik/category/l2
```

**KHÔNG CÓ endpoint nào cho:**
- ❌ `/api/v3/echotik/seller/{id}/revenue` - Revenue breakdown
- ❌ `/api/v3/echotik/seller/{id}/revenue/breakdown` - By video/live/cart
- ❌ `/api/v3/echotik/shop/rankings` - Shop rankings
- ❌ `/api/v3/echotik/creator/list` - Creators/affiliates

### 4.2 Dữ liệu revenue từ `/seller/list` response

Từ JSON response thực tế:

```json
{
  "seller_id": "7494084364488967268",
  "seller_name": "Hải Anh Lee",
  
  // ✅ Có doanh số tổng
  "total_sale_gmv_amt": 9.27,
  "total_sale_gmv_1d_amt": 0,
  "total_sale_gmv_7d_amt": 0,
  "total_sale_gmv_30d_amt": 0,
  "total_sale_gmv_90d_amt": 0,
  
  // ✅ Có sales count
  "total_sale_cnt": 1,
  "total_sale_1d_cnt": 0,
  "total_sale_7d_cnt": 0,
  "total_sale_30d_cnt": 0,
  "total_sale_90d_cnt": 0,
  
  // ❓ IFL (không rõ)
  "total_ifl_cnt": 1,
  "total_ifl_1d_cnt": 0,
  "total_ifl_7d_cnt": 0,
  "total_ifl_30d_cnt": 0,
  "total_ifl_90d_cnt": 0,
  
  // ❌ KHÔNG CÓ breakdown theo:
  // - Video vs Live vs Cart
  // - Affiliate vs Direct
  // - Category
}
```

### 4.3 So sánh với Prisma schema

```prisma
model ShopRevenueSnapshot {
  id BigInt @id @default(autoincrement())
  shopId Int
  source String
  capturedAt DateTime @default(now())
  bucketDate DateTime @db.Date
  
  // ← Apify có thể cung cấp
  gmvVideo Decimal?        // Video sales
  gmvLive Decimal?         // Live sales
  gmvCart Decimal?         // Shopping cart
  gmvProductCard Decimal?  // Product card
  gmvTotal Decimal?        // ← EchoTik chỉ có cái này
  
  soldCountTotal BigInt?
  productCount Int?
  avgOrderValue Decimal?
  ratingScore Decimal?
  ratingCount BigInt?
  
  isEstimated Boolean @default(false)
  rawData Json?
}
```

### 4.4 Kết luận: Revenue breakdown

**EchoTik cung cấp:**
- ✅ `total_sale_gmv_*_amt` - GMV tổng (không breakdown)
- ✅ `total_sale_*_cnt` - Số đơn/lượt bán
- ✅ `total_ifl_*_cnt` - ??? (chưa xác minh)
- ❌ KHÔNG breakdown theo Video/Live/Cart/ProductCard

**Hạn chế:**
- ⚠️ Không thể điền `gmvVideo`, `gmvLive`, `gmvCart`, `gmvProductCard` từ EchoTik
- ⚠️ Chỉ có `gmvTotal`

**Giải pháp:**
- Kết hợp Apify (có breakdown) + EchoTik (tổng để verify)
- Hoặc để NULL nếu không có dữ liệu

**Status:** ❌ **ECHOTIK CHỈ CÓ TỔNG, KHÔNG CÓ BREAKDOWN**

---

## VẤN ĐỀ 5: CREATOR, AFFILIATE, VIDEO ENDPOINTS

### 5.1 Kiểm tra client EchoTik - Endpoints hiện có

Từ `echoTikClient.ts` - **CHỈ CÓ 5 ENDPOINTS:**

```typescript
1. getSellerList() → /api/v3/echotik/seller/list
2. getProductList() → /api/v3/echotik/product/list
3. getProductTrend() → /api/v3/echotik/product/trend
4. getCategoryL1() → /api/v3/echotik/category/l1
5. getCategoryL2() → /api/v3/echotik/category/l2
```

### 5.2 Kiểm tra tài liệu - ECHOTIK_API_REQUEST_PREVIEW.md

**Danh sách endpoint test dự kiến:**
```
✅ GET /api/v3/echotik/category/l1 - 1 request
✅ GET /api/v3/echotik/category/l2 - 1 request
✅ GET /api/v3/echotik/product/list - 1 request
✅ GET /api/v3/echotik/product/trend - 1 request
✅ GET /api/v3/echotik/seller/list - 1 request
= 5 requests tổng cộng

KHÔNG CÓ ENDPOINT CHO:
❌ Creator / Affiliate list
❌ Shop/Creator rankings
❌ Video content
```

### 5.3 Kiểm tra schema EchoTik types - `types/echotik.ts`

```typescript
// Định nghĩa response types
export interface EchoTikSellerResponse { }      // ← Shop data
export interface EchoTikProductData { }         // ← Product data
export interface EchoTikCategoryData { }        // ← Category data

// ❌ KHÔNG CÓ:
// export interface EchoTikCreatorData
// export interface EchoTikAffiliateResponse
// export interface EchoTikVideoResponse
```

### 5.4 Kiểm tra normalizer - `echoTikNormalizer.ts`

```typescript
export function normalizeEchoTikProduct() { }
export function normalizeEchoTikShop() { }
export function normalizeEchoTikProducts() { }

// ❌ KHÔNG CÓ:
// export function normalizeEchoTikCreator()
// export function normalizeEchoTikAffiliate()
// export function normalizeEchoTikVideo()
```

### 5.5 Kiểm tra API tester - `echoTikApiTester.ts`

```typescript
testCategoryL1() { }
testCategoryL2() { }
testProductList() { }
testProductTrend() { }
testSellerList() { }

// ❌ KHÔNG CÓ test cho:
// testCreatorList()
// testAffiliateList()
// testVideoList()
// testRankings()
```

### 5.6 Danh sách endpoint EchoTik KHÔNG implement

| Entity | Endpoint | Status | Bằng chứng |
|---|---|---|---|
| **Shop/Seller** | `/api/v3/echotik/seller/list` | ✅ IMPLEMENT | echoTikClient.ts:120 |
| **Product** | `/api/v3/echotik/product/list` | ✅ IMPLEMENT | echoTikClient.ts:158 |
| **Product Trend** | `/api/v3/echotik/product/trend` | ✅ IMPLEMENT | echoTikClient.ts:135 |
| **Category L1** | `/api/v3/echotik/category/l1` | ✅ IMPLEMENT | echoTikClient.ts:173 |
| **Category L2** | `/api/v3/echotik/category/l2` | ✅ IMPLEMENT | echoTikClient.ts:186 |
| **Creator** | `/api/v3/echotik/creator/list` | ❌ NOT FOUND | - |
| **Affiliate** | `/api/v3/echotik/affiliate/list` | ❌ NOT FOUND | - |
| **Affiliate by Shop** | `/api/v3/echotik/seller/{id}/affiliates` | ❌ NOT FOUND | - |
| **Shop Ranking** | `/api/v3/echotik/seller/ranking` | ❌ NOT FOUND | - |
| **Creator Ranking** | `/api/v3/echotik/creator/ranking` | ❌ NOT FOUND | - |
| **Video List** | `/api/v3/echotik/video/list` | ❌ NOT FOUND | - |
| **Video Trend** | `/api/v3/echotik/video/trend` | ❌ NOT FOUND | - |

### 5.7 Kết luận: Creator, Affiliate, Video

**Status:** ❌ **KHÔNG CÓ ENDPOINT - KHÔNG THỂ IMPORT DỮ LIỆU**

**Khả năng hiện tại:**
- ✅ Shop / Seller
- ✅ Product
- ✅ Product Trend (limited)
- ✅ Category (L1, L2)
- ❌ Creator - KHÔNG CÓ API
- ❌ Affiliate - KHÔNG CÓ API
- ❌ Video / Content - KHÔNG CÓ API
- ❌ Rankings - KHÔNG CÓ API

**Hạn chế:**
- EchoTik hiện chỉ hỗ trợ shop/product/category
- Không thể lấy creator/affiliate data từ EchoTik
- Phải dùng Apify hoặc nguồn khác cho creator/video

---

## TÓMMARY: CHIẾN LƯỢC XỬ LÝ XUNG ĐỘT & PHẠM VI

### Chiến lược xử lý xung đột Apify/EchoTik

#### 1. Khóa định danh
- **Giả định:** Apify `seller.sellerId` == EchoTik `seller_id` (cùng TikTok Shop ID chính thức)
- **Mapping:** `platformShopId` = `seller_id` (TikTok unique ID)

#### 2. Quy tắc Update
Khi gặp cùng `platformShopId`:

```
IF source_apify exists AND source_echotik exists:
  - MERGE thành 1 record với source="hybrid"
  - Apify data: name, username, avatarUrl, shopUrl, followerCount (social)
  - EchoTik data: ratingScore, ratingCount, productCount, echotikMetadata
  - Snapshot: tạo 2 snapshot riêng (source="apify" vs source="echotik")
  
IF only source_apify:
  - Giữ nguyên
  
IF only source_echotik:
  - Tạo mới
```

#### 3. ShopRevenueSnapshot
- Lưu riêng snapshot theo source
- `@@unique([shopId, source, bucketDate])`
- Khi query rankings: merge cả hai source hoặc ưu tiên one

### Phạm vi đồng bộ theo từng nhóm dữ liệu

#### Nhóm 1: Shop (READY)
- ✅ Endpoint: `/seller/list`
- ✅ Mapping: Xác minh seller_id match
- ✅ Schema: Thêm `source` field
- ⏱️ Timeline: Phase 1 (lần đầu)

#### Nhóm 2: Product (READY)
- ✅ Endpoint: `/product/list`
- ✅ Mapping: product_id → platformProductId
- ⚠️ Cần verify: Apify vs EchoTik product ID format
- ⏱️ Timeline: Phase 1 (lần đầu)

#### Nhóm 3: Category (READY)
- ✅ Endpoint: `/category/l1`, `/category/l2`
- ✅ Mapping: category_id → slug
- ⏱️ Timeline: Phase 1 (lần đầu)

#### Nhóm 4: Product Trend (LIMITED)
- ✅ Endpoint: `/product/trend`
- ⚠️ Cần xác minh: "trend" là gì? (ranking? search volume? sales trend?)
- ⏱️ Timeline: Phase 2 (sau khi clear definition)

#### Nhóm 5: Shop Snapshot (READY)
- ✅ Endpoint: `/seller/list` (periodic)
- ✅ Mapping: Lưu vào ShopRevenueSnapshot
- ⚠️ Cần xác minh: total_sale_gmv_amt đơn vị + total_ifl_cnt nghĩa
- ⏱️ Timeline: Phase 1 (sau khi xác minh)

#### Nhóm 6: Creator/Affiliate (BLOCKED)
- ❌ Endpoint: KHÔNG CÓ
- ❌ Không thể import từ EchoTik
- ➡️ Giải pháp: Dùng Apify hoặc API khác
- ⏱️ Timeline: Future (nếu EchoTik thêm endpoint)

#### Nhóm 7: Video/Content (BLOCKED)
- ❌ Endpoint: KHÔNG CÓ
- ❌ EchoTik không cung cấp video data
- ➡️ Giải pháp: Dùng Apify creative center
- ⏱️ Timeline: Future (nếu EchoTik thêm endpoint)

#### Nhóm 8: Ranking (BLOCKED)
- ❌ Endpoint: KHÔNG CÓ
- ❌ EchoTik không cung cấp ranking API
- ➡️ Giải pháp: Tính từ product/shop snapshots
- ⏱️ Timeline: Post-ingestion (aggregation)

### Các trường mapping chính xác

#### Shop → Prisma

| EchoTik | Prisma | Type | Required | Notes |
|---|---|---|---|---|
| `seller_id` | `platformShopId` | string | ✅ | TikTok unique ID |
| `seller_name` | `name` | string | ✅ | Shop name |
| `seller_link` | `shopUrl` | string | ⚠️ | Parse username |
| `region` | `region` | string | ✅ | "VN" |
| `followers_count` | `followerCount` | BigInt | ❓ | Có thể null |
| `rating` | `ratingScore` | Decimal(4,2) | ❓ | Có thể null |
| `review_count` | `ratingCount` | BigInt | ❓ | Có thể null |
| `total_crawl_product_cnt` | `productCount` | Int | ✅ | ≥ 0 |
| `cover_url` | `bannerUrl` | string | ❓ | Optional |
| `sec_uid` | `echotikMetadata.sec_uid` | JSON | ❌ | Lưu trong JSON |
| `shop_type` | `echotikMetadata.shopType` | JSON | ❌ | Lưu trong JSON |
| `response_rate` | `echotikMetadata.responseRate` | JSON | ❌ | Lưu trong JSON |
| `delivery_rate` | `echotikMetadata.deliveryRate` | JSON | ❌ | Lưu trong JSON |
| `category_id` | `primaryCategoryId` (FK) | Int | ❌ | Link to Category |

#### Product → Prisma

| EchoTik | Prisma | Notes |
|---|---|---|
| `product_id` | `platformProductId` | Unique |
| `title` | `title` | |
| `price` | `minPrice` / `maxPrice` | |
| `rating` | `ratingScore` | |
| `soldCount` | `soldCount` | |
| `seller_id` | `shopId` (via platformShopId) | Foreign key |

#### ShopRevenueSnapshot → Prisma

| EchoTik | Prisma | Unit | Notes |
|---|---|---|---|
| `total_sale_gmv_amt` | `gmvTotal` | ??? | **CẦN XÁC MINH** |
| `total_sale_gmv_30d_amt` | `gmv30d` | ??? | New field needed |
| `total_sale_gmv_90d_amt` | `gmv90d` | ??? | New field needed |
| `total_sale_cnt` | `soldCountTotal` | Count | **CẦN VERIFY** |
| `total_ifl_cnt` | `iflTotal` (JSON) | ??? | Lưu trong JSON |
| `first_crawl_dt` | `capturedAt` | Date | Snapshot timestamp |

### Migration dự kiến

#### Migration 1: Thêm source tracking (PRIORITY)
```sql
ALTER TABLE Shop ADD COLUMN source VARCHAR(50) DEFAULT 'apify';
ALTER TABLE Shop ADD COLUMN echotikMetadata JSONB;

ALTER TABLE Creator ADD COLUMN source VARCHAR(50) DEFAULT 'apify';
ALTER TABLE Creator ADD COLUMN echotikMetadata JSONB;

ALTER TABLE ShopRevenueSnapshot ADD COLUMN source VARCHAR(50) DEFAULT 'apify';

CREATE UNIQUE INDEX idx_shop_platformshopid_source 
  ON Shop(platformShopId, source);
```

#### Migration 2: Thêm category linking (OPTIONAL)
```sql
ALTER TABLE Shop ADD COLUMN primaryCategoryId INT;
ALTER TABLE Shop ADD CONSTRAINT fk_shop_category 
  FOREIGN KEY (primaryCategoryId) REFERENCES Category(id) ON DELETE SET NULL;
```

#### Migration 3: Thêm revenue detail fields (OPTIONAL)
```sql
ALTER TABLE ShopRevenueSnapshot ADD COLUMN gmv30d DECIMAL(20,2);
ALTER TABLE ShopRevenueSnapshot ADD COLUMN gmv90d DECIMAL(20,2);
ALTER TABLE ShopRevenueSnapshot ADD COLUMN iflData JSONB;
```

### File cần tạo

1. **`src/services/echotik/echoTikShopSyncService.ts`**
   - Sync shop từ EchoTik (full → periodic)
   - Xử lý conflict Apify/EchoTik
   - Update ShopRevenueSnapshot

2. **`src/services/echotik/echoTikProductSyncService.ts`**
   - Sync product từ EchoTik
   - Link với shop

3. **`src/services/echotik/echoTikCategorySyncService.ts`**
   - Sync category/subcategory
   - Build hierarchy

4. **`src/scripts/syncEchoTikFull.ts`**
   - Master script: shop + product + category
   - Tính toán quota
   - Log result

### File cần sửa

1. **`prisma/schema.prisma`**
   - Thêm `source` vào Shop, Creator
   - Thêm `echotikMetadata` JSON
   - Thêm unique constraint mới

2. **`src/services/echotik/echoTikShopIngestionService.ts`**
   - Xử lý conflict logic
   - Update quy tắc
   - Log decision (created/updated/skipped + why)

3. **`src/services/scraper/ingestionService.ts`**
   - Hỗ trợ source parameter
   - Merge Apify + EchoTik shop

4. **`src/services/echotik/echoTikNormalizer.ts`**
   - Normalize product
   - Normalize category
   - Handle ifl_cnt, gmv_amt

5. **`.env.example`**
   - Thêm comment rõ ràng về EchoTik fields
   - Ví dụ giá trị

---

## ĐIỀU KIỆN PHÁT HÀNH: XÁC NHẬN CẦN THIẾT

**⚠️ DỪNG HOÀN TOÀN - CẦN XÁC NHẬN 5 ĐIỂM:**

### 1️⃣ SELLER_ID MATCH
**Câu hỏi:** Apify `seller.sellerId` có bằng EchoTik `seller_id` không?

**Cần xác minh:**
- [ ] Sample Apify response với seller_id value
- [ ] So sánh format với EchoTik (numeric string?)
- [ ] Xác nhận có thể ghép được bằng `platformShopId` hay cần mapping table

**Phục vụ:** Quyết định conflict resolution strategy

---

### 2️⃣ DOANH SỐ ECHOTIK
**Câu hỏi:** `total_sale_gmv_amt`, `total_ifl_*_cnt` là gì?

**Cần xác minh (từ tài liệu EchoTik chính thức):**
- [ ] `total_sale_gmv_amt` đơn vị tiền tệ (USD / VND / CNY)?
- [ ] `total_sale_*_cnt` = số order hay số lượt bán?
- [ ] `total_ifl_*_cnt` = gì? (IFL = ?)
- [ ] Tại sao có cả `total_sale_gmv_amt` và `total_ifl_cnt`? Khác nhau thế nào?
- [ ] Dữ liệu nào lấy cho GMV, dữ liệu nào cho sold count?

**Phục vụ:** Mapping chính xác vào DB

---

### 3️⃣ THIẾT KẾ NGUỒN DỮ LIỆU
**Câu hỏi:** Có thêm `source` field không?

**Lựa chọn:**
- [ ] **Option A:** Thêm `source` vào Shop model (khuyến nghị)
- [ ] **Option B:** ShopProvenance table (tracking detail)
- [ ] **Option C:** rawData JSON only (simple)

**Phục vụ:** Xác định migration scope

---

### 4️⃣ REVENUE BREAKDOWN
**Câu hỏi:** EchoTik có breakdown video/live/cart không?

**Kết quả phân tích:** ❌ KHÔNG CÓ - EchoTik chỉ cung cấp tổng `gmvTotal`

**Hỏi cho xác nhận:**
- [ ] Đúng không, chỉ có tổng không có breakdown?
- [ ] Có cần phải để NULL các `gmvVideo`, `gmvLive`, `gmvCart` fields?
- [ ] Hay sẽ merge từ Apify breakdown + EchoTik tổng?

**Phục vụ:** Thiết kế ShopRevenueSnapshot schema

---

### 5️⃣ CREATOR/AFFILIATE/VIDEO
**Câu hỏi:** Có endpoint nào cho creator/affiliate/video không?

**Kết quả phân tích:** ❌ KHÔNG CÓ - Chỉ có shop + product + category + trend

**Hỏi cho xác nhận:**
- [ ] Đúng không, EchoTik không cung cấp creator API?
- [ ] Affiliate data lấy từ đâu? (Apify? Manual?)
- [ ] Video content lấy từ Apify creative center hay khác?
- [ ] Phạm vi Phase 1 là chỉ Shop + Product + Category? (creator/video Phase 2)

**Phục vụ:** Xác định phạm vi Phase 1

---

## BÁOCÁO KÊTLUẬN

### ✅ ĐÃ XÁC MINH

1. **10 shop data hợp lệ:** Tất cả đều có seller_id, seller_name, region="VN"
2. **EchoTik client ready:** 5 endpoints đã implement (seller, product, category L1/L2, trend)
3. **Quota safe:** 50/tháng, hiện chỉ plan 5-10 requests/tháng
4. **Apify integration active:** shopNormalizer.ts có logic lấy seller.sellerId

### ⚠️ CẦN XÁC MINH TRƯỚC CODE

1. **Seller ID match:** Apify seller_id == EchoTik seller_id?
2. **Doanh số:** GMV unit + IFL definition
3. **Source tracking:** Có cần migration hay JSON?
4. **Revenue breakdown:** Chỉ tổng hay có breakdown?
5. **Creator/Affiliate:** Phạm vi Phase 1 là gì?

### ❌ KHÔNG CÓ / BLOCKED

1. Creator API ← KHÔNG CÓ
2. Affiliate API ← KHÔNG CÓ
3. Video API ← KHÔNG CÓ
4. Revenue breakdown ← KHÔNG CÓ
5. Ranking API ← KHÔNG CÓ

---

## NEXT: DỪNG CHỜ OK BẮT ĐẦU CODE

**Vui lòng xác nhận 5 điểm ⚠️ trên.**

Khi có đủ xác nhận, sẽ lập kế hoạch chi tiết:
- Migration scripts
- Ingest service layer (shop, product, category)
- Conflict resolution logic
- Snapshot update strategy
- Test plan

**File này:**
`D:\tiktok-scraper-ts\COMPREHENSIVE_ECHOTIK_ANALYSIS.md`

