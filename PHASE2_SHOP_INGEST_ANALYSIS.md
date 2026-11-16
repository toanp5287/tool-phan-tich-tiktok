# PHASE 2 – PHÂN TÍCH INGEST SHOP ECHOTIK

## 1. CẤU TRÚC JSON RESPONSE ECHOTIK (THỰC TẾ)

```json
{
  "seller_id": "seller_123456",           // Định danh cửa hàng EchoTik
  "seller_name": "Shop Test VN",          // Tên cửa hàng
  "seller_link": "https://shop.tiktok.com/@seller_123456",
  "sec_uid": "sec_uid_123",               // Secondary UID
  "region": "VN",
  "followers_count": 10000,               // Số người theo dõi
  "rating": 4.8,                          // Điểm đánh giá
  "review_count": 5000,                   // Số đánh giá
  "response_rate": 0.99,                  // Tỉ lệ phản hồi
  "positive_feedback_rate": 0.98,         // Tỉ lệ phản hồi tích cực
  "delivery_rate": 0.95,                  // Tỉ lệ giao hàng
  "total_crawl_product_cnt": 150,         // Tổng số sản phẩm
  "spu_avg_price": 250000,                // Giá trung bình sản phẩm
  "min_price": 50000,                     // Giá thấp nhất
  "max_price": 5000000,                   // Giá cao nhất
  "shop_type": "Official",                // Loại shop
  "shop_identity_label": "Authentic",     // Nhãn xác thực
  "sales_flag": 1,                        // Có bán hàng
  "sales_trend_flag": 1,                  // Xu hướng bán hàng
  "total_ifl_1d_cnt": 1000,               // Doanh số 1 ngày
  "total_ifl_7d_cnt": 10000,              // Doanh số 7 ngày
  "total_ifl_30d_cnt": 50000,             // Doanh số 30 ngày
  "total_ifl_90d_cnt": 100000,            // Doanh số 90 ngày
  "category_id": "cat_123",               // Danh mục L1
  "category_l2_id": "cat_l2_456",         // Danh mục L2
  "category_l3_id": "cat_l3_789",         // Danh mục L3
  "first_crawl_dt": "2026-10-01",         // Ngày cào đầu tiên
  "cover_url": "https://...",             // URL ảnh bìa
  "original_cover_url": "https://...",    // URL ảnh gốc
  "product_category_list": ["Fashion"],   // Danh sách danh mục sản phẩm
  "most_product_category_list": ["Fashion"]
}
```

---

## 2. PRISMA SCHEMA – MODEL SHOP

```prisma
model Shop {
  id             Int     @id @default(autoincrement())
  platformShopId String  @unique                           // ← KHÓA: seller_id từ EchoTik
  name           String                                     // ← seller_name
  username       String?                                    // ← Chưa có trong EchoTik JSON
  avatarUrl      String?                                    // ← Chưa có
  bannerUrl      String?                                    // ← cover_url? original_cover_url?
  shopUrl        String?                                    // ← seller_link

  region        String  @default("VN")                      // ← region
  followerCount BigInt?                                     // ← followers_count

  // Tổng hợp thương mại (từ snapshot)
  productCount   Int      @default(0)                       // ← total_crawl_product_cnt
  soldCountTotal BigInt?                                    // ← tính từ ifl_*_cnt?
  gmvTotal       Decimal? @db.Decimal(20, 2)              // ← GMV từ đâu?
  avgOrderValue  Decimal? @db.Decimal(20, 2)              // ← spu_avg_price?
  ratingScore    Decimal? @db.Decimal(4, 2)               // ← rating
  ratingCount    BigInt?                                    // ← review_count

  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([region, name])
  @@index([lastSeenAt])
  @@index([username])
  @@index([region, gmvTotal])
}
```

---

## 3. MAPPING ECHOTIK → PRISMA

| EchoTik Field | Prisma Field | Ghi chú |
|---------------|--------------|--------|
| seller_id | platformShopId | **KHÓA ĐỊNH DANH** – @unique |
| seller_name | name | Bắt buộc |
| seller_link | shopUrl | URL shop |
| region | region | Mặc định "VN" |
| followers_count | followerCount | BigInt |
| rating | ratingScore | Decimal(4,2) |
| review_count | ratingCount | BigInt |
| total_crawl_product_cnt | productCount | Int |
| spu_avg_price | avgOrderValue | Decimal(20,2) – **CẦN XÁC MINH** |
| total_ifl_30d_cnt | soldCountTotal | BigInt – **CẦN CALC HOẶC LẤY TỪ ĐÂU?** |
| ??? | gmvTotal | **CHƯA TÌM ĐƯỢC FIELD** trong response |
| cover_url | bannerUrl | URL ảnh bìa |
| sec_uid | ??? | **KHÔNG CÓ FIELD** trong Prisma |
| shop_type, shop_identity_label | ??? | **KHÔNG CÓ FIELD** – CẦN THÊM VÀO? |
| response_rate, positive_feedback_rate, delivery_rate | ??? | **KHÔNG CÓ FIELD** – CẦN THÊM VÀO? |
| category_id, category_l2_id, category_l3_id | ??? | **KHÔNG CÓ FIELD** – Liên kết danh mục? |

---

## 4. CÁC VẤN ĐỀ CẦN QUYẾT ĐỊNH

### 4.1 Chống trùng Shop
- **Khóa định danh:** `platformShopId` = `seller_id` (EchoTik)
- **Cơ chế:** Dùng `upsert()` như hiện tại
  - Nếu `platformShopId` tồn tại → update
  - Nếu không → create
- **Vấn đề:** Apify cũng lưu `platformShopId`. Cần kiểm tra Apify dùng seller ID gì.

### 4.2 Bảo vệ dữ liệu Apify
- **Hiện trạng:** Schema không có `source` field để phân biệt EchoTik vs Apify
- **Rủi ro:** Nếu cùng `seller_id`, update từ EchoTik sẽ ghi đè dữ liệu Apify
- **Giải pháp cần duyệt:**
  - Option A: Thêm `source` field vào Shop model (cần migration)
  - Option B: Giữ nguyên, chỉ update field không xung đột
  - Option C: Tạo ShopSnapshot riêng cho mỗi source

### 4.3 Trường dữ liệu chưa mapping
- **Chưa tìm được:** gmvTotal (doanh số tổng)
- **Chưa tìm được:** username (tên người dùng)
- **Chưa tìm được:** avatarUrl (ảnh đại diện)
- **Phải quyết định:** Dùng `NULL` hay field khác?

### 4.4 Dữ liệu EchoTik chưa có field trong Prisma
- sec_uid
- shop_type
- shop_identity_label
- response_rate
- positive_feedback_rate
- delivery_rate
- category_id, category_l2_id, category_l3_id

**Cách xử lý:**
- Option A: Bỏ qua (không lưu)
- Option B: Thêm vào rawData/metadata JSON field
- Option C: Thêm new columns vào Shop

### 4.5 Tính toán doanh số
- **ifl_1d, ifl_7d, ifl_30d, ifl_90d** = gì?
  - Doanh số (GMV)?
  - Số đơn hàng?
  - Số lượt xem?
- **soldCountTotal** nên dùng field nào từ EchoTik?

---

## 5. LUỒNG INGESTION DỰ KIẾN

```
1. Nhận response từ /api/v3/echotik/seller/list
   ↓
2. Mapping từng shop EchoTik → ScrapedShopRecord format
   ↓
3. Kiểm tra seller_id có tồn tại trong DB không
   ↓
4. Nếu tồn tại:
   - Kiểm tra source (Apify hay EchoTik)
   - Quyết định update hay skip
   ↓
5. Nếu không tồn tại:
   - Tạo shop mới với source = 'echotik'
   ↓
6. Lưu vào ShopRevenueSnapshot nếu có doanh số
   ↓
7. Log result: created/updated/skipped
```

---

## 6. FILE CẦN SỬA / TẠO

### File cần tạo (nếu cấp phép):
- `src/services/echotik/echoTikShopIngestion.ts` – Ingest shop từ EchoTik

### File cần sửa (nếu cấp phép):
- `prisma/schema.prisma` – Thêm `source` field hoặc JSON metadata (nếu quyết định)
- `src/services/scraper/ingestionService.ts` – Cập nhật để hỗ trợ EchoTik source

---

## 7. RỦI RO VÀ VẤN ĐỀ CHƯA XÁC MINH

1. **Khóa định danh:** Apify dùng seller ID nào? Có match với EchoTik seller_id không?
2. **GMV:** EchoTik JSON không có trường gmvTotal rõ ràng. Tính từ đâu?
3. **Source tracking:** Schema hiện tại không phân biệt source. Ghi đè dữ liệu Apify?
4. **Username/Avatar:** EchoTik không trả. Để NULL hay bỏ qua?
5. **Doanh số 90 ngày:** Nên dùng total_ifl_90d_cnt hay field khác?

---

## 8. ĐIỀU KIỆN PHÁT HÀNH

**✅ SẴN SÀNG TRIỂN KHAI NẾU:**
- Xác nhận mapping fields (đặc biệt gmvTotal, soldCountTotal)
- Xác nhận cách xử lý conflict với Apify (source priority)
- Xác nhận dữ liệu extra (sec_uid, shop_type, etc.) bỏ hay giữ

**⏸️ CẦN DUYỆT TRƯỚC:**
- Có thêm `source` field vào Shop không?
- Có cần migration hay dùng JSON metadata?
- Apify seller_id match với EchoTik seller_id không?

---

**DỪNG CHỜ CONFIRM**

Vui lòng xác nhận:
1. Mapping fields có đúng không?
2. Cách xử lý conflict Apify?
3. Có thêm field mới vào schema không?

Sau confirm, sẽ triển khai ingest Shop.
