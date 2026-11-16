-- GMV trong snapshot được tính bằng price x cumulative soldCount (ước tính),
-- không phải doanh thu TikTok công bố. Đánh dấu toàn bộ dữ liệu cũ.
UPDATE "ProductSnapshot" SET "isEstimated" = true WHERE "isEstimated" = false;
UPDATE "ShopProductSnapshot" SET "isEstimated" = true WHERE "isEstimated" = false;
