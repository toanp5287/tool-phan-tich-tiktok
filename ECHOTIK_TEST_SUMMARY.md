# SUMMARY: ECHOTIK API TEST - QUOTA & REQUEST ESTIMATE

## REQUEST BREAKDOWN

| # | Endpoint | Calls | Quota/Call | Total |
|----|----------|-------|-----------|-------|
| 1 | GET /v1/categories | 1 | 1 | **1** |
| 2 | GET /v1/products/search | 1 | 1 | **1** |
| 3 | GET /v1/sellers/{id} | 3-5 | 1 | **3-5** |
| 4 | GET /v1/category/{id}/trend | 2 | 1 | **2** |
| 5 | GET /v1/product/{id}/trend | 2 | 1 | **2** |

**TOTAL ESTIMATE: 9-11 requests**
**QUOTA LIMIT: 50/month**
**REMAINING AFTER TEST: 39-41/50** ✅

---

## WHAT WILL BE TESTED

### ✅ WILL DO
- ✅ Gọi 5 endpoint theo thứ tự (1, 2, 3, 4, 5)
- ✅ Kiểm tra response schema (structure, fields, types)
- ✅ Xác minh phân trang (pagination)
- ✅ Xác minh đơn vị GMV, doanh số, ngày thống kê
- ✅ Theo dõi quota trước/sau mỗi request
- ✅ Lập bảng kết quả endpoint + fields
- ✅ Báo cáo unverified fields

### ❌ WILL NOT DO
- ❌ Ingest vào PostgreSQL
- ❌ Chạy ingestion pipeline
- ❌ Chạy scheduler
- ❌ Gọi API ngoài 5 endpoint trên
- ❌ Vượt quota 11 requests
- ❌ Chỉnh sửa database

---

## REQUEST DETAILS

**Sellers to test:** 3-5 (từ product search results)
**Category trends:** 2 categories
**Product trends:** 2 products

---

## OUTPUT

Sau test, sẽ lập bảng:
1. **Endpoint Status Table** - Success/Fail per endpoint
2. **Schema Field Table** - Tất cả fields, types, units, examples
3. **Unverified Fields List** - Fields chứa ??? hoặc cần xác minh
4. **Quota Summary** - Before/After, usage tracking
5. **Issues & Recommendations** - Các vấn đề tìm được

---

## CONFIRM BEFORE PROCEEDING

**Xác nhận OK để bắt đầu kiểm thử?**

Cần confirm:
1. ✅ Gọi **9-11 requests** được không?
2. ✅ Test **sellers x3-5, trends x2** được không?
3. ✅ **KHÔNG ingest** vào DB được không?
4. ✅ **KHÔNG chạy ingestion/scheduler** được không?
5. ✅ **KHÔNG gọi API ngoài danh sách 5** được không?

Chờ lệnh:

```
OK BẮT ĐẦU KIỂM THỬ
```
