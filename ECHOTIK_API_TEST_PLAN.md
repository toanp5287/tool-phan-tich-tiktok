# GIAI ĐOẠN KIỂM THỬ API ECHOTIK

## ENDPOINT KIỂM THỬ (Thứ tự)

1. **GET /v1/categories** - Category L1/L2/L3
2. **GET /v1/products/search** - Product List  
3. **GET /v1/sellers/{id}** - Seller List
4. **GET /v1/category/{id}/trend** - Category Trend
5. **GET /v1/product/{id}/trend** - Product Trend

---

## KIỂM THỬ CHI TIẾT

### 1. Category L1/L2/L3
**Endpoint:** `GET /v1/categories`
**Params:** (tùy thuộc doc API)
**Mục tiêu:**
- ✅ Lấy danh sách L1/L2/L3
- ✅ Kiểm tra schema (categoryId, name, level, parentId, etc.)
- ✅ Kiểm tra phân cấp
- ✅ Quota: 1 request

**Response Schema Cần Kiểm Tra:**
```
categories: [
  {
    categoryId: string,
    name: string,
    level: 1|2|3,
    parentId?: string,
    productCount?: number,
    gmvTotal?: number,
    soldCount?: number,
    description?: string,
    ...
  }
]
```

---

### 2. Product List (Search)
**Endpoint:** `GET /v1/products/search`
**Params:** `q=...&limit=10&offset=0` (or similar)
**Mục tiêu:**
- ✅ Lấy 10 sản phẩm (test phân trang)
- ✅ Kiểm tra schema sản phẩm
- ✅ Xác minh GMV, doanh số unit
- ✅ Kiểm tra ngày thống kê
- ✅ Quota: 1 request

**Response Schema Cần Kiểm Tra:**
```
products: [
  {
    productId: string,
    title: string,
    price: number,
    originalPrice?: number,
    currency?: string,
    soldCount?: number,
    gmvTotal?: number,
    gmv1d?: number,
    gmv7d?: number,
    gmv30d?: number,
    ratingScore?: number,
    ratingCount?: number,
    shop?: { sellerId, name, ... },
    capturedAt?: datetime,
    ...
  }
]
pagination: {
  page: number,
  pageSize: number,
  total: number,
  totalPages?: number
}
```

---

### 3. Seller List (Từ Product)
**Endpoint:** `GET /v1/sellers/{sellerId}`
**Mục tiêu:**
- ✅ Lấy thông tin 1 seller (top shop)
- ✅ Kiểm tra schema seller
- ✅ Xác minh GMV tổng, rating
- ✅ Kiểm tra followerCount
- ✅ Quota: 1 request (test 1 seller trước)

**Response Schema Cần Kiểm Tra:**
```
seller: {
  sellerId: string,
  name: string,
  username?: string,
  avatarUrl?: string,
  shopUrl?: string,
  followerCount?: number,
  productCount?: number,
  gmvTotal?: number,
  gmv1d?: number,
  gmv7d?: number,
  gmv30d?: number,
  soldCountTotal?: number,
  ratingScore?: number,
  ratingCount?: number,
  capturedAt?: datetime,
  ...
}
```

---

### 4. Category Trend
**Endpoint:** `GET /v1/category/{categoryId}/trend` (or similar)
**Mục tiêu:**
- ✅ Lấy xu hướng ngành hàng
- ✅ Kiểm tra schema
- ✅ Xác minh dữ liệu top products/sellers
- ✅ Quota: 1 request

**Response Schema Cần Kiểm Tra:**
```
trend: {
  categoryId: string,
  period: "1d"|"7d"|"30d",
  gmvChange: number,
  soldCountChange: number,
  topProducts: [{ productId, title, gmv, ... }],
  topSellers: [{ sellerId, name, gmv, ... }],
  capturedAt?: datetime,
  ...
}
```

---

### 5. Product Trend
**Endpoint:** `GET /v1/product/{productId}/trend` (or similar)
**Mục tiêu:**
- ✅ Lấy xu hướng sản phẩm
- ✅ Kiểm tra schema
- ✅ Xác minh dữ liệu bán hàng
- ✅ Quota: 1 request

**Response Schema Cần Kiểm Tra:**
```
trend: {
  productId: string,
  period: "1d"|"7d"|"30d",
  gmv: number,
  gmvChange: number,
  soldCount: number,
  soldCountChange: number,
  avgPrice: number,
  topSellers: [{ sellerId, name, gmv, ... }],
  capturedAt?: datetime,
  ...
}
```

---

## QUOTA ESTIMATE

| Endpoint | Per Call | Calls | Total |
|----------|----------|-------|-------|
| /v1/categories | 1 | 1 | 1 |
| /v1/products/search | 1 | 1 | 1 |
| /v1/sellers/{id} | 1 | 3-5 | 5 |
| /v1/category/{id}/trend | 1 | 2 | 2 |
| /v1/product/{id}/trend | 1 | 2 | 2 |

**TOTAL ESTIMATE: 11 requests**
**QUOTA LIMIT: 50/month**
**SAFETY BUFFER: 39 requests remaining** ✅

---

## KIỂM THỬ WORKFLOW

### Bước 1: Tạo EchoTikTester Service
File: `src/services/echotik/echoTikTester.ts`

Chức năng:
- Gọi từng endpoint theo thứ tự
- Lưu quota trước/sau mỗi request
- Kiểm tra response schema
- In report chi tiết
- **KHÔNG ingest** vào DB

### Bước 2: Tạo Test Script
File: `src/scripts/testEchoTikApi.ts`

Chức năng:
- Chạy tester service
- In báng kết quả endpoint
- Báo cáo schema fields
- Báo cáo unverified items

### Bước 3: Chạy Kiểm Thử
```bash
LOG_LEVEL=error node dist/scripts/testEchoTikApi.js
```

### Bước 4: Lập Bảng Kết Quả
- Endpoint status (success/fail)
- Response fields (type, unit, examples)
- Unverified fields (chứa "???", cần confirm)
- Quota tracking
- Issues/warnings

---

## ĐỒ NGẠN KIỂM THỬ

```
1. Init Quota Tracker
   ├─ Get current quota
   └─ Log: 50/50 available

2. Test /v1/categories
   ├─ Call API
   ├─ Check schema
   ├─ Log quota: 49/50
   └─ Save response sample

3. Test /v1/products/search
   ├─ Call API
   ├─ Check schema + pagination
   ├─ Log quota: 48/50
   └─ Extract seller IDs for later

4. Test /v1/sellers/{id} x 3
   ├─ Call API for seller 1, 2, 3
   ├─ Check schema
   ├─ Log quota: 45/50
   └─ Save seller data

5. Test /v1/category/{id}/trend x 2
   ├─ Call API for category 1, 2
   ├─ Check schema
   ├─ Log quota: 43/50
   └─ Save trend data

6. Test /v1/product/{id}/trend x 2
   ├─ Call API for product 1, 2
   ├─ Check schema
   ├─ Log quota: 41/50
   └─ Save trend data

7. Generate Report
   ├─ Endpoint summary table
   ├─ Field mapping table
   ├─ Unverified fields list
   ├─ Quota usage summary
   └─ Issues + recommendations
```

---

## KHÔNG LÀM

❌ Ingest vào PostgreSQL
❌ Chạy ingestion pipeline
❌ Chạy scheduler
❌ Gọi API ngoài 5 endpoint trên
❌ Vượt quota 11 requests
❌ Lưu raw response vào DB
❌ Chỉnh sửa database

---

## OUTPUT DỰ KIẾN

```
========================================
ECHOTIK API TEST REPORT
========================================

QUOTA USAGE:
  Before: 50/50
  After: 39/50
  Used: 11 requests
  Status: ✅ OK

ENDPOINTS TESTED:
  ✅ GET /v1/categories
  ✅ GET /v1/products/search
  ✅ GET /v1/sellers/{id} x3
  ✅ GET /v1/category/{id}/trend x2
  ✅ GET /v1/product/{id}/trend x2

SCHEMA VERIFICATION:
[Table of endpoints, fields, types, units]

UNVERIFIED FIELDS:
[List of ??? fields needing confirmation]

ISSUES:
[Any API errors or schema mismatches]

STATUS: ✅ READY FOR PRODUCTION
========================================
```

---

## ĐỢI CONFIRM

**Các câu hỏi trước khi bắt đầu:**

1. ✅ Có gọi 11 requests đó được không? (quota còn 39)
2. ✅ Có thử test mỗi endpoint 1 lần được không? (sellers x3, trends x2)
3. ✅ Có phải chắc chắn KHÔNG ingest vào DB? (yes)
4. ✅ Có báo cáo lại tất cả fields lạ/chưa xác minh được không? (yes)
