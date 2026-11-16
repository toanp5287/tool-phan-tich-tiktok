/**
 * Taxonomy ngành hàng dùng cho mô hình drill-down 4 cấp:
 * Cấp 1 Category -> Cấp 2 Sub-category -> Cấp 3 Shop -> Cấp 4 Shop/Video.
 *
 * Từ khoá được viết KHÔNG dấu để so khớp trên văn bản đã chuẩn hoá,
 * nhờ đó hoạt động với cả tiêu đề tiếng Việt có dấu lẫn không dấu.
 */

export interface SubCategoryRule {
  name: string;
  keywords: string[];
}

export interface CategoryRule {
  name: string;
  keywords: string[];
  subCategories: SubCategoryRule[];
}

export const DEFAULT_CATEGORY = 'Khác';
export const DEFAULT_SUB_CATEGORY = 'Tổng hợp';

export const CATEGORY_RULES: readonly CategoryRule[] = [
  {
    name: 'Mỹ phẩm & Làm đẹp',
    keywords: [
      'beauty', 'cosmetic', 'skin care', 'personal care',
      'my pham', 'makeup', 'trang diem', 'son moi', 'son', 'kem chong nang', 'chong nang', 'skincare',
      'duong da', 'duong the', 'serum', 'toner', 'kem duong', 'sua rua mat', 'rua mat', 'tay trang',
      'mat na', 'cushion', 'phan', 'mascara', 'ke mat', 'chi ke', 'tri mun', 'mun', 'nuoc hoa', 'perfume',
      'dau goi', 'dau xa', 'sua tam', 'xit khoang', 'body', 'lot', 'duong am', 'retinol', 'vitamin c',
      'collagen', 'son duong', 'kem nen', 'concealer', 'highlighter', 'blush', 'ma hong', 'mi gia',
    ],
    subCategories: [
      { name: 'Chăm sóc da', keywords: ['duong da', 'skincare', 'serum', 'toner', 'kem duong', 'sua rua mat', 'rua mat', 'tay trang', 'mat na', 'tri mun', 'mun', 'duong am', 'retinol', 'vitamin c', 'chong nang', 'kem chong nang'] },
      { name: 'Trang điểm', keywords: ['trang diem', 'makeup', 'son moi', 'son', 'cushion', 'phan', 'mascara', 'ke mat', 'chi ke', 'kem nen', 'concealer', 'highlighter', 'blush', 'ma hong', 'mi gia', 'son duong'] },
      { name: 'Nước hoa', keywords: ['nuoc hoa', 'perfume', 'xịt thơm', 'xit thom'] },
      { name: 'Chăm sóc tóc & cơ thể', keywords: ['dau goi', 'dau xa', 'sua tam', 'xit khoang', 'body', 'lot', 'duong the'] },
    ],
  },
  {
    name: 'Thời trang & Phụ kiện',
    keywords: [
      'fashion', 'clothing', 'apparel', 'accessories',
      'thoi trang', 'ao', 'quan', 'vay', 'dam', 'set do', 'hoodie', 'ao thun', 'thun', 'so mi', 'jeans',
      'giay', 'dep', 'sneaker', 'sandal', 'tui xach', 'tui', 'balo', 'vi', 'that lung', 'khan', 'mu',
      'non', 'trang suc', 'day chuyen', 'bong tai', 'nhan', 'vong', 'kinh mat', 'ao khoac', 'bra',
      'do lot', 'set bo', 'do the thao', 'chan vay', 'ao len', 'cardigan', 'polo', 'short', 'legging',
    ],
    subCategories: [
      { name: 'Áo', keywords: ['ao thun', 'thun', 'so mi', 'hoodie', 'ao khoac', 'ao len', 'cardigan', 'polo', 'bra', 'ao'] },
      { name: 'Quần & Váy', keywords: ['quan', 'jeans', 'short', 'legging', 'vay', 'dam', 'chan vay', 'set do', 'set bo'] },
      { name: 'Giày dép', keywords: ['giay', 'dep', 'sneaker', 'sandal', 'giay the thao'] },
      { name: 'Túi xách & Balo', keywords: ['tui xach', 'tui', 'balo', 'vi', 'that lung'] },
      { name: 'Phụ kiện', keywords: ['khan', 'mu', 'non', 'trang suc', 'day chuyen', 'bong tai', 'nhan', 'vong', 'kinh mat', 'do lot'] },
    ],
  },
  {
    name: 'Đồ gia dụng & Nhà cửa',
    keywords: [
      'home', 'household', 'kitchen', 'furniture',
      'gia dung', 'nha cua', 'noi', 'chao', 'dao', 'thot', 'bat', 'dia', 'ly', 'coc', 'ke', 'tu', 'gia',
      'sofa', 'goi', 'nem', 'chan', 'ga', 'rem', 'tham', 'may hut bui', 'noi com', 'bon rua', 'do nha bep',
      'dung cu', 'hop dung', 'moc treo', 'den', 'quat', 'may loc', 'binh nuoc', 'khay', 'luoi', 'ao treo',
      'ban', 'ghe', 'tu lanh', 'may giat', 'do dung', 'nha bep', 'phong ngu', 'phong khach',
    ],
    subCategories: [
      { name: 'Nhà bếp', keywords: ['noi', 'chao', 'dao', 'thot', 'bat', 'dia', 'ly', 'coc', 'noi com', 'bon rua', 'do nha bep', 'nha bep', 'binh nuoc', 'khay'] },
      { name: 'Nội thất', keywords: ['sofa', 'ke', 'tu', 'gia', 'ban', 'ghe', 'tu lanh', 'nem', 'goi'] },
      { name: 'Trang trí & Dọn dẹp', keywords: ['rem', 'tham', 'den', 'may hut bui', 'do dung', 'hop dung', 'moc treo', 'luoi', 'ao treo', 'may loc', 'quat'] },
      { name: 'Chăn ga gối', keywords: ['chan', 'ga', 'goi', 'nem'] },
    ],
  },
  {
    name: 'Điện tử & Công nghệ',
    keywords: [
      'electronics', 'technology', 'gadget',
      'dien tu', 'cong nghe', 'dien thoai', 'op lung', 'sac du phong', 'pin', 'tai nghe', 'loa', 'chuot',
      'ban phim', 'usb', 'camera', 'smartwatch', 'dong ho thong minh', 'robot', 'may say', 'quat dien',
      'tivi', 'laptop', 'ipad', 'airpods', 'sac', 'cap', 'day sac', 'google', 'android', 'ios', 'bluetooth',
    ],
    subCategories: [
      { name: 'Điện thoại & Phụ kiện', keywords: ['dien thoai', 'op lung', 'sac du phong', 'pin', 'sac', 'cap', 'day sac', 'usb'] },
      { name: 'Âm thanh', keywords: ['tai nghe', 'loa', 'airpods', 'bluetooth'] },
      { name: 'Thiết bị thông minh', keywords: ['smartwatch', 'dong ho thong minh', 'robot', 'camera', 'may say', 'quat dien'] },
      { name: 'Máy tính & Tablet', keywords: ['laptop', 'ipad', 'chuot', 'ban phim', 'tivi'] },
    ],
  },
  {
    name: 'Thực phẩm & Đồ uống',
    keywords: [
      'food', 'beverage', 'snack',
      'thuc pham', 'do uong', 'banh', 'keo', 'tra', 'ca phe', 'nuoc', 'do an vat', 'an vat', 'hat', 'kho',
      'muc', 'gia vi', 'dau an', 'nuoc mam', 'mi', 'pho', 'bun', 'com', 'snack', 'chocolate', 'ye',
      'sua tuoi', 'nuoc ngot', 'ruou', 'bia', 'cafe', 'tra sua', 'banh trang', 'kho bo', 'khô ga',
    ],
    subCategories: [
      { name: 'Đồ ăn vặt', keywords: ['banh', 'keo', 'do an vat', 'an vat', 'snack', 'chocolate', 'kho', 'muc', 'kho bo', 'banh trang'] },
      { name: 'Đồ uống', keywords: ['do uong', 'tra', 'ca phe', 'cafe', 'nuoc', 'nuoc ngot', 'ruou', 'bia', 'tra sua', 'sua tuoi'] },
      { name: 'Gia vị & Nấu ăn', keywords: ['gia vi', 'dau an', 'nuoc mam', 'mi', 'pho', 'bun', 'com', 'hat'] },
    ],
  },
  {
    name: 'Mẹ & Bé',
    keywords: [
      'kids', 'mother',
      'me va be', 'em be', 'tre em', 'baby', 'bim', 'ta', 'sua bot', 'an dam', 'do choi', 'binh sua',
      'xe day', 'ghe an', 'quan ao be', 'tre so sinh', 'so sinh', 'con nit', 'do so sinh',
    ],
    subCategories: [
      { name: 'Sữa & Ăn dặm', keywords: ['sua bot', 'an dam', 'sua', 'binh sua'] },
      { name: 'Tã & Bỉm', keywords: ['bim', 'ta', 'so sinh'] },
      { name: 'Đồ chơi trẻ em', keywords: ['do choi', 'con nit'] },
      { name: 'Quần áo & Xe đẩy', keywords: ['quan ao be', 'xe day', 'ghe an', 'em be', 'tre em'] },
    ],
  },
  {
    name: 'Thể thao & Du lịch',
    keywords: [
      'sport', 'fitness', 'travel',
      'the thao', 'gym', 'yoga', 'bong', 'ao tap', 'quan tap', 'giay the thao', 'vali', 'hanh ly',
      'du lich', 'leu', 'da ngoai', 'cau long', 'pickleball', 'bong da', 'bong ro', 'dumbbell',
    ],
    subCategories: [
      { name: 'Trang phục thể thao', keywords: ['ao tap', 'quan tap', 'giay the thao', 'the thao'] },
      { name: 'Dụng cụ tập luyện', keywords: ['gym', 'yoga', 'dumbbell', 'cau long', 'pickleball', 'bong'] },
      { name: 'Du lịch & Dã ngoại', keywords: ['vali', 'hanh ly', 'du lich', 'leu', 'da ngoai'] },
    ],
  },
  {
    name: 'Sức khoẻ',
    keywords: [
      'health', 'supplement',
      'suc khoe', 'thuc pham chuc nang', 'vitamin', 'collagen', 'thuoc', 'y te', 'khoang', 'men vi sinh',
      'giam can', 'tra giam can', 'huyet ap', 'nhiet ke', 'khau trang', 'tpcn', 'omega', 'canxi',
      'ho tro tieu hoa', 'detox', 'protein',
    ],
    subCategories: [
      { name: 'Thực phẩm chức năng', keywords: ['thuc pham chuc nang', 'tpcn', 'vitamin', 'collagen', 'omega', 'canxi', 'protein', 'men vi sinh', 'detox', 'giam can'] },
      { name: 'Dụng cụ y tế', keywords: ['y te', 'thuoc', 'huyet ap', 'nhiet ke', 'khau trang', 'khoang'] },
    ],
  },
  {
    name: 'Ô tô & Xe máy',
    keywords: [
      'automotive', 'motorcycle',
      'o to', 'xe may', 'vo xe', 'lop xe', 'phu tung', 'dau nhot', 'son xe', 'guong', 'den xe',
      'xe dap', 'xe dien', 'phu kien xe', 'noi that o to',
    ],
    subCategories: [
      { name: 'Phụ tùng & Phụ kiện', keywords: ['phu tung', 'phu kien xe', 'guong', 'den xe', 'noi that o to'] },
      { name: 'Dầu nhớt & Chăm sóc xe', keywords: ['dau nhot', 'son xe', 'vo xe', 'lop xe'] },
    ],
  },
  {
    name: 'Sách & Văn phòng phẩm',
    keywords: [
      'book', 'stationery',
      'sach', 'van phong pham', 'vo', 'but', 'tap', 'giay a4', 'do dung hoc tap', 'sach noi', 'truyen',
      'giao trinh', 'but bi', 'but chi', 'keo dan', 'may tinh bo tui',
    ],
    subCategories: [
      { name: 'Sách', keywords: ['sach', 'truyen', 'giao trinh', 'sach noi'] },
      { name: 'Văn phòng phẩm', keywords: ['van phong pham', 'vo', 'but', 'tap', 'giay a4', 'but bi', 'but chi', 'keo dan', 'may tinh bo tui'] },
    ],
  },
];

export const CATEGORY_NAMES: readonly string[] = CATEGORY_RULES.map((rule) => rule.name);

export function findCategoryRule(name: string): CategoryRule | undefined {
  const normalized = name.trim().toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.name.toLowerCase() === normalized);
}
