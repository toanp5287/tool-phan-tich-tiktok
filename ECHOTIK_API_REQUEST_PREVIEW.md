# ECHOTIK API TEST - REQUEST PREVIEW

## BASE URL
https://open.echotik.live

## AUTH
HTTP Basic Auth: Authorization: Basic Base64(username:password)
(Credentials từ .env: ECHOTIK_USERNAME, ECHOTIK_PASSWORD)

---

## ENDPOINT 1: Category L1
**Request:**
```
GET /api/v3/echotik/category/l1?language=vi-VN
```

**Parameters:**
- language=vi-VN (bắt buộc)

**Requests Used:** 1

---

## ENDPOINT 2: Category L2
**Request:**
```
GET /api/v3/echotik/category/l2?language=vi-VN&parent_id=<L1_ID_TỪ_ENDPOINT_1>
```

**Parameters:**
- language=vi-VN (bắt buộc)
- parent_id=<categoryId lấy từ Category L1 response>

**Requests Used:** 1

---

## ENDPOINT 3: Product List
**Request:**
```
GET /api/v3/echotik/product/list?region=VN&page_num=1&page_size=10
```

**Parameters:**
- region=VN (bắt buộc)
- page_num=1 (trang đầu)
- page_size=10 (10 sản phẩm/trang)

**Requests Used:** 1
**Note:** Lấy product_id từ response để dùng ở Endpoint 4

---

## ENDPOINT 4: Product Trend
**Request:**
```
GET /api/v3/echotik/product/trend?product_id=<PRODUCT_ID_TỪ_ENDPOINT_3>&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&page_num=1&page_size=10
```

**Parameters:**
- product_id=<product_id lấy từ Product List response - endpoint 3>
- start_date=YYYY-MM-DD (30 ngày trước hôm nay)
- end_date=YYYY-MM-DD (hôm nay)
- page_num=1
- page_size=10

**Requests Used:** 1
**Note:** Date format: YYYY-MM-DD (e.g., 2026-10-06 đến 2026-11-05)

---

## ENDPOINT 5: Seller List
**Request:**
```
GET /api/v3/echotik/seller/list?region=VN&page_num=1&page_size=10
```

**Parameters:**
- region=VN (bắt buộc)
- page_num=1 (trang đầu)
- page_size=10 (10 sellers/trang)

**Requests Used:** 1

---

## QUOTA SUMMARY

| Endpoint | Requests |
|----------|----------|
| Category L1 | 1 |
| Category L2 | 1 |
| Product List | 1 |
| Product Trend | 1 |
| Seller List | 1 |
| **TOTAL** | **5** |

**Quota Limit:** 50/month
**Remaining After Test:** 45/month
**Status:** ✅ SAFE

---

## CONFIRM TRƯỚC KHI CHẠY

**URL và parameters trên có đúng không?**

```
OK - BẮT ĐẦU KIỂM THỬ API
```

Hoặc nếu có điều chỉnh:

```
SỬA LẠI: [chi tiết sửa]
```
