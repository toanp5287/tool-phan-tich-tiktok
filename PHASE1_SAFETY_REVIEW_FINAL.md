# PHASE 1 SAFETY REVIEW — KIỂM TRA TRỰC TIẾP HOÀN CHỈNH

**Ngày:** 2026-11-06  
**Mục đích:** Xác minh 4 vấn đề trước khi triển khai Phase 1  
**Phương pháp:** Đọc source code + kiểm tra schema + phân tích dữ liệu JSON

---

## 1. XÁC MINH 10 PLATFORMSHOPID BỊ TRÙNG

### Dữ liệu đã kiểm tra
Từ file `data/echotik/seller-list-2026-11-05T19-41-35-084Z.json`:
```
10 shops từ EchoTik API:
1. 7494084364488967268 — Hương Anh Lee
2. 7494084365700793920 — Nhung Silk Lụa từ tầm Nha XÃ
3. 7494084316255520155 — KhoÃ Cá-a Tay NÃ_m Tá Enger
4. 7494084363889771543 — Gia DÆng Nhá HoÃng
5. 7494088402780260043 — RealMen09xx
6. 7494088028217378084 — Anxinji
7. 7494084316232254755 — YÃªn SÃ¡o Cam LÃ¡m KhÃ¡nh HoÃ
8. 7494084364149818968 — CÃ¡ng NghÃ Xây DÆng HYM
9. 7494084316270986341 — LÆ¡Æ°m NguyÃªn
10. 7494086491953530398 — CÃ¡m QuyÃªn-Dâu Gá»-ChÃ¡nh HÃng
```

### Kết quả kiểm tra
✅ **10 bản ghi tồn tại** trong API response  
⚠️ **CHƯA XÁC MINH TRONG DATABASE** (database connection timeout)

**Kết luận tạm thời:**
- EchoTik API có đủ 10 shops
- Không thể xác minh bản ghi hiện có trong Shop table (DB không kết nối được)
- **Action:** Chạy query sau khi khôi phục DB:
  ```sql
  SELECT COUNT(*) FROM "Shop" WHERE "platformShopId" IN (
    '7494084364488967268', '7494084365700793920', '7494084316255520155',
    '7494084363889771543', '7494088402780260043', '7494088028217378084',
    '7494084316232254755', '7494084364149818968', '7494084316270986341',
    '7494086491953530398'
  );
  ```

### Nguồn dữ liệu cũ?
- **Không liên quan đến snapshot hoặc historical data**
- Đây là lần đầu tiên import từ EchoTik (API mới)
- Nếu 10 shops này đã tồn tại, chúng từ **Apify import cũ**

---

## 2. ĐÁNH GIÁ REVISED PHASE 1 — SKIP vs UPSERT

### Tình trạng hiện tại (echoTikShopIngestionService.ts:131-138)
```typescript
const existing = await prisma.shop.findUnique({
  where: { platformShopId },
  select: { id: true },
});
if (existing) {
  result.skipped += 1;  // ← SKIP nếu đã tồn tại
  continue;
}
await prisma.shop.create({ ... });  // ← Chỉ tạo nếu chưa có
```

✅ **Logic hiện tại là ĐÚNG** — không upsert, không ghi đè

### Nếu skip toàn bộ ID đã tồn tại?
**Câu hỏi:** 10 Shop có được import không?

**Câu trả lời:**
- **KHÔNG.** Nếu 10 IDs này đã tồn tại từ Apify → sẽ bị skip hết
- `result.created = 0`, `result.skipped = 10`
- **Frontend sẽ không thấy EchoTik shops** (vì chỉ là skip, không có dữ liệu mới)

### Đề xuất: Bổ sung có điều kiện (mà không ghi đè)
**Phương án:** Thêm `source` field vào Shop model để phân biệt nguồn, hoặc:

**Tùy chọn A (đơn giản — Phase 1):**
- Giữ nguyên skip logic
- Log rõ ràng: "Shop already exists, skipped"
- Phase 2 sẽ quyết định: cho phép multi-source hay không

**Tùy chọn B (phức tạp — Phase 2+):**
- Thêm `source` field + `@@unique([platformShopId, source])`
- Cho phép cùng 1 platformShopId từ 2 nguồn khác nhau
- Cần migration database

---

## 3. SO SÁNH 3 PHƯƠNG ÁN

### Phương án 1: Skip bản ghi trùng (HIỆN TẠI)
**Ưu điểm:**
- ✅ Không ghi đè dữ liệu cũ
- ✅ An toàn, không mất dữ liệu
- ✅ Không cần migration

**Nhược điểm:**
- ❌ 10 shops không được import nếu đã tồn tại
- ❌ Không phân biệt nguồn dữ liệu

**Rủi ro dữ liệu:**
- ✅ KHÔNG CÓ — data an toàn

**Kết luận:** ✅ An toàn nhất cho Phase 1

---

### Phương án 2: Bổ sung có điều kiện (chỉ cập nhật NULL)
**Ưu điểm:**
- ✅ Bổ sung dữ liệu mới (followerCount, rating, v.v.)
- ✅ Không xóa dữ liệu Apify cũ

**Nhược điểm:**
- ⚠️ Cần logic phức tạp để xác định "field nào là NULL"
- ⚠️ Apify & EchoTik có field khác nhau (không match)

**Rủi ro dữ liệu:**
- ⚠️ TRUNG BÌNH — có thể tạo inconsistent data

**Kết luận:** ⚠️ Quá phức tạp cho Phase 1

---

### Phương án 3: Bổ sung source tracking + multi-source shops
**Ưu điểm:**
- ✅ Lưu trữ nguồn rõ ràng
- ✅ Cho phép cùng shop từ nhiều API

**Nhược điểm:**
- ❌ Cần migration database (ALTER TABLE, ADD COLUMN)
- ❌ Cần thay đổi unique constraint
- ❌ Quá scope lớn cho Phase 1

**Rủi ro dữ liệu:**
- ❌ CAO — migration có thể fail hoặc corrupt data nếu không hợp lý

**Kết luận:** ❌ KHÔNG nên cho Phase 1

---

## 4. CHỐT PHASE 1 — PHƯƠNG ÁN ĐƯỢC CHỌN

### Mục tiêu Phase 1
1. ✅ 10 Shop EchoTik được lưu (hoặc skip nếu đã tồn tại)
2. ✅ Không mất dữ liệu lịch sử
3. ✅ Không ghi đè sai dữ liệu
4. ✅ Có log created / updated / skipped / failed rõ ràng
5. ✅ Có cách xác minh kết quả trong PostgreSQL

### Phương ÁN CHỌN: **Phương án 1 + Cải thiện log**

**Thay đổi:**
1. **Giữ nguyên skip logic** (không upsert)
2. **Cải thiện logging:**
   - Thêm `result.skipReasons` để giải thích tại sao skip
   - Log: `"platformShopId already exists in DB, skipped"`

3. **Thêm endpoint API:**
   - `POST /api/admin/echotik/sync-shops`
   - Return: `{ created: X, skipped: Y, failed: Z, reasons: [...] }`

4. **Tạo script verification:**
   - Script SQL để kiểm tra 10 IDs có trong DB không

### Tại sao phương án này?
- ✅ Không ghi đè Apify data
- ✅ An toàn 100%
- ✅ Không cần migration
- ✅ Dễ bắt đầu Phase 2 (nếu quyết định cho multi-source)

---

## 5. KIỂM TRA SCHEMA & SOURCE PRIORITY

### Xác minh: ShopRevenueSnapshot & ProductSnapshot đã có `source`?
✅ **CÓ:**
- `ShopRevenueSnapshot.source` (schema.prisma:430)
- `ProductSnapshot.source` (schema.prisma:494)
- `CreatorSnapshot.source` (schema.prisma:398)

✅ **Unique constraints đã là composite:**
- `ShopRevenueSnapshot: @@unique([shopId, source, bucketDate])` (line 452)
- `ProductSnapshot: @@unique([productId, source, bucketDate])` (line 532)

### Xác minh: Shop model không có `source` field?
✅ **ĐÚNG:**
- Shop model chỉ có `@unique` trên `platformShopId` (line 264)
- Không có `source` field

### Xác minh: sourcePriorityService có fallback Apify?
✅ **CÓ:**
- `SOURCE_PRIORITY = { echotik: 1, apify: 2 }`
- `getPreferredSnapshot()` dùng Apify nếu EchoTik không có

**Hàm ý:** Nếu EchoTik chưa populate ShopRevenueSnapshot → hệ thống sẽ dùng Apify snapshot (fallback)

---

## 6. MIGRATION CẦN THIẾT?

### Cho Phase 1?
**KHÔNG CẦN.** Schema đã sẵn sàng.

### Cho Phase 2 (nếu quyết định multi-source)?
**CÓ THỂ CẦN:**
```sql
-- Nếu quyết định cho phép cùng 1 shop từ nhiều source:
ALTER TABLE "Shop" DROP CONSTRAINT "Shop_platformShopId_key";
ALTER TABLE "Shop" ADD COLUMN "source" VARCHAR(50) DEFAULT 'apify';
ALTER TABLE "Shop" ADD CONSTRAINT idx_shop_platform_source 
  UNIQUE ("platformShopId", "source");
```

**Nhưng:** Quyết định này không cần cho Phase 1

---

## 7. FILE CẦN MODIFY/CREATE

### Phase 1 (Revised)

**MODIFY (3 files):**
1. ✏️ `src/services/echotik/echoTikShopIngestionService.ts`
   - Add `result.skipReasons: string[]`
   - Log: "platformShopId already exists" khi skip

2. ✏️ `src/controllers/echoTikController.ts`
   - Add `POST /api/admin/echotik/sync-shops` endpoint
   - Return ingestion result với counts

3. ✏️ `.env.example`
   - Document `ECHOTIK_MAX_SHOPS_PER_IMPORT=10`

**CREATE (1 file):**
1. ✨ `src/scripts/syncEchoTikShops.ts`
   - Orchestrator: call getSellerList → ingestEchoTikShops → return result
   - ~50 lines

**NOT NEEDED:**
- ✗ Database migration
- ✗ Schema changes
- ✗ New fields (source, v.v.)
- ✗ Product/Category sync files

---

## 8. VERIFICATION STEPS

### Step 1: Chạy Phase 1 import
```bash
npm run sync-echotik-shops
```

### Step 2: Kiểm tra trong PostgreSQL
```sql
SELECT COUNT(*) as total_from_echotik FROM "Shop" 
WHERE "platformShopId" IN (
  '7494084364488967268', '7494084365700793920', '7494084316255520155',
  '7494084363889771543', '7494088402780260043', '7494088028217378084',
  '7494084316232254755', '7494084364149818968', '7494084316270986341',
  '7494086491953530398'
);
-- Expected: 0-10 (tùy vào có tồn tại trước không)
```

### Step 3: Kiểm tra log
```
"Received: 10, Created: X, Skipped: Y, Failed: Z"
```

### Step 4: Kiểm tra API
```bash
curl -X POST http://localhost:3000/api/admin/echotik/sync-shops \
  -H "Authorization: Bearer <token>"
```

---

## 9. KẾT LUẬN

### ✅ CÓ THỂ TRIỂN KHAI PHASE 1?
**CÓ**, với điều kiện:
1. Giữ nguyên skip logic (không upsert)
2. Cải thiện logging để rõ lý do skip
3. Tạo endpoint API để trigger sync
4. KHÔNG cần migration database

### 🔴 VẤN ĐỀ CẦN CHỜ DUYỆT
1. **Database connection timeout** — cần khôi phục để xác minh dữ liệu hiện có
2. **Quyết định Phase 2:** Cho phép multi-source shops hay lock trên 1 source?
3. **Revenue breakdown:** EchoTik không cung cấp video/live/cart breakdown — cần Apify TrendItem cho Phase 2B

### 📋 DANH SÁCH TÓM TẮT
| Mục | Trạng thái | Ghi chú |
|-----|-----------|--------|
| Schema sẵn sàng | ✅ | Có source fields, unique constraints đúng |
| 10 shops từ API | ✅ | Xác minh trong JSON file |
| Skip logic an toàn | ✅ | Không ghi đè Apify data |
| Migration cần thiết | ❌ | Không cần cho Phase 1 |
| Files cần tạo | 1 | syncEchoTikShops.ts |
| Files cần sửa | 3 | Ingestion + Controller + .env |
| Database ready | ⚠️ | CHƯA XÁC MINH (timeout) |

---

**Trạng thái:** ✅ **AN TOÀN ĐỂ TRIỂN KHAI** (sau khi khôi phục DB)

