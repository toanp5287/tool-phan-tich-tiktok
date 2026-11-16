# GIAI ĐOẠN KIỂM TRA XÁC THỰC ECHOTIK

## YÊU CẦU

1. ✅ Kiểm tra cấu hình credentials từ .env
2. ✅ Kiểm tra Basic Authentication header
3. ✅ Kiểm tra endpoint xác thực phù hợp theo tài liệu EchoTik
4. ✅ Không in username/password hoặc Authorization header ra log
5. ✅ Không gọi API nếu chưa có lệnh cho phép
6. ✅ Không chạy scheduler hoặc đồng bộ hàng loạt
7. ✅ Báo cáo endpoint dự kiến, số request dự kiến, kết quả kiểm tra

## KẾ HOẠCH TRIỂN KHAI

### Bước 1: Tạo EchoTikAuthVerifier Service
File: `src/services/echotik/echoTikAuthVerifier.ts`

Chức năng:
- Kiểm tra biến môi trường (enabled, username, password)
- Kiểm tra format Basic Auth header (không in ra)
- Log thông tin an toàn (không credentials)
- Tạo report về cấu hình

### Bước 2: Tạo Script Kiểm Tra (Manual)
File: `src/scripts/verifyEchoTikAuth.ts`

Chức năng:
- Chạy kiểm tra từ dòng lệnh
- In report chi tiết (endpoints, request count estimate)
- Không gọi API thật
- Cảnh báo nếu thiếu credentials

### Bước 3: Kiểm Tra Cấu Hình Hiện Tại
- Đọc .env
- Kiểm tra đã set credentials chưa
- List endpoints dự kiến
- Tính toán request budget

### Bước 4: Tài Liệu
- Định nghĩa các endpoint EchoTik
- Mô tả xác thực Basic Auth
- Hướng dẫn test

## ENDPOINT DỰ KIẾN (từ code hiện tại)

```
GET /v1/products/search      - Tìm kiếm sản phẩm (1 request)
GET /v1/categories           - Lấy danh mục (1 request)
GET /v1/sellers/{id}         - Lấy info cửa hàng (N requests = số shops)
GET /v1/quota                - Lấy quota info (1 request)
GET /v1/products/{id}        - Chi tiết sản phẩm (optional, N requests)
```

## REQUEST BUDGET ESTIMATE

Mỗi sync full:
- 1x search products
- 1x categories
- ~10-20x sellers/{id} (top shops)
- 1x quota check
= **~12-22 requests/sync**

Quota limit: 50/tháng
= **~2-4 syncs/tháng max**

## THÔNG TIN SẼ KIỂM TRA

✅ ECHOTIK_ENABLED = true/false
✅ ECHOTIK_USERNAME = (không in)
✅ ECHOTIK_PASSWORD = (không in)
✅ ECHOTIK_BASE_URL = valid URL
✅ ECHOTIK_REGION = VN
✅ ECHOTIK_LANGUAGE = vi-VN
✅ ECHOTIK_MAX_REQUESTS_PER_MONTH = 50
✅ ECHOTIK_TIMEOUT = 30000ms
✅ Basic Auth Header format (không in)
✅ Request budget estimate

## KHÔNG LÀM

❌ Gọi API thật
❌ In credentials
❌ Chạy sync
❌ Thay đổi database
❌ Ghi đè Apify config
