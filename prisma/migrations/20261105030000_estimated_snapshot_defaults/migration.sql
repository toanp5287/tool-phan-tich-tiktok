-- GMV/doanh số trong snapshot là giá trị ước tính (price x cumulative soldCount),
-- không phải doanh thu TikTok công bố. Đặt default true để mọi bản ghi mới
-- được đánh dấu đúng ngay cả khi tầng ứng dụng không set thủ công.
ALTER TABLE "ProductSnapshot" ALTER COLUMN "isEstimated" SET DEFAULT true;
ALTER TABLE "ShopProductSnapshot" ALTER COLUMN "isEstimated" SET DEFAULT true;
