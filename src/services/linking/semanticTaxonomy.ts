/**
 * Multilingual keyword index mapping raw text -> the dataset's own taxonomy
 * (Category + SubCategory rows already present in the DB). Used for the
 * "nearest meaningful group" (INFERRED / PROVISIONAL) fallback when a source
 * provides no canonical category path. Keywords are folded (see utils/text.ts)
 * so Vietnamese with/without diacritics, English and Chinese marketplace terms
 * all match.
 *
 * ponytail: brand/model/attribute extraction is not implemented — there is no
 * Brand entity in the schema and no reliable brand field in the source payloads.
 * Add a Brand model + extraction when a brand-bearing source lands.
 */

export interface SubCategoryKeywords {
  /** Exact DB SubCategory.name (resolved by name at runtime). */
  name: string;
  keywords: string[];
}

export interface CategoryKeywords {
  /** Exact DB Category.name. */
  category: string;
  /** Broad keywords that indicate this category without a specific sub-category. */
  keywords: string[];
  subCategories: SubCategoryKeywords[];
}

export const SEMANTIC_TAXONOMY: readonly CategoryKeywords[] = [
  {
    category: 'Điện tử & Công nghệ',
    keywords: ['electronics', 'dien tu', 'cong nghe', 'gadget', 'smart', 'usb', 'bluetooth', 'charger', 'sac', 'cable', 'hdmi'],
    subCategories: [
      { name: 'Âm thanh', keywords: ['tai nghe', 'earphone', 'headphone', 'earbud', 'loa', 'speaker', 'airpods', 'audio', 'sound', 'bluetooth', 'micro', 'mic'] },
      { name: 'Audio & Video', keywords: ['audio', 'video', 'earphone', 'headphone', 'speaker', 'soundbar', 'microphone'] },
      { name: 'Mobile Phone Accessories', keywords: ['phone case', 'op lung', 'screen protector', 'mieng dan', 'phone holder', 'charger', 'sac', 'cable', 'day sac', 'phone accessories', 'usb', 'power bank', 'sac du phong'] },
      { name: 'Phones & Tablets', keywords: ['phone', 'dien thoai', 'smartphone', 'tablet', 'ipad', 'iphone', 'android', 'celular', 'pencil case', 's pen', 'galaxy tab', 'tab'] },
      { name: 'Smart & Wearable Devices', keywords: ['smartwatch', 'dong ho thong minh', 'smart watch', 'wearable', 'fitness tracker', 'smart band', 'watch band', 'wristband'] },
      { name: 'Cameras & Photography', keywords: ['camera', 'photography', 'webcam', 'lens', 'action camera', 'gopro', 'digital camera'] },
      { name: 'Tablet & Computer Accessories', keywords: ['laptop', 'keyboard', 'ban phim', 'mouse', 'chuot', 'computer', 'stand', 'monitor', 'laptop stand'] },
    ],
  },
  {
    category: 'Thời trang & Phụ kiện',
    keywords: ['fashion', 'thoi trang', 'apparel', 'clothing', 'quan ao', 'outfit', 'wear', 'ao', 'quan', 'vay', 'dam', 'hoodie', 'sweatshirt', 'sweater', 'shirt', 'dress', 'tee'],
    subCategories: [
      { name: "Women's Tops", keywords: ['top', 'blouse', 'shirt', 'ao', 'tee', 'tshirt', 't-shirt', 'crop top', 'camisole', 'hoodie', 'sweatshirt', 'sweater', 'jacket'] },
      { name: "Men's Tops", keywords: ['men shirt', 'polo', 'tee nam', 'ao nam', 'shirt men', 'sweater', 'hoodie', 'sweatshirt', 'jacket nam', 'couple hoodie'] },
      { name: "Women's Dresses", keywords: ['dress', 'vay', 'dam', 'gown', 'sundress', 'maxi', 'bodycon'] },
      { name: "Women's Bottoms", keywords: ['pants', 'skirt', 'quan', 'legging', 'shorts', 'jeans', 'trousers'] },
      { name: "Men's Bottoms", keywords: ['men pants', 'quan nam', 'men shorts', 'men jeans', 'chinos'] },
      { name: 'Women\'s Underwear', keywords: ['underwear', 'bra', 'lingerie', 'do lot', 'panties', 'bikini', 'ao nguc'] },
      { name: "Women's Sleepwear & Loungewear", keywords: ['pajamas', 'pijama', 'sleepwear', 'do ngu', 'nightgown', 'loungewear', 'pyjama'] },
      { name: 'Eyewear', keywords: ['sunglasses', 'kinh mat', 'eyeglasses', 'glasses', 'cermin mata', 'gafas'] },
      { name: 'Fashion Watches & Accessories', keywords: ['watch', 'dong ho', 'wristwatch', 'jewelry watch', 'watch band', 'watch strap', 'wristband'] },
      { name: 'Costume Jewelry & Accessories', keywords: ['jewelry', 'trang suc', 'necklace', 'day chuyen', 'earrings', 'bong tai', 'bracelet', 'vong', 'ring', 'nhan', 'jewellery'] },
      { name: 'Clothes Accessories', keywords: ['belt', 'that lung', 'scarf', 'khan', 'hat', 'mu', 'non', 'gloves', 'tie', 'cravat', 'accessories', 'ear warmer', 'earmuff', 'ear muff', 'headband', 'ikat kepala'] },
      { name: 'Hair Extensions & Wigs', keywords: ['wig', 'toc gia', 'hair extension', 'hairpiece', 'weave'] },
      { name: "Men's Underwear & Socks", keywords: ['socks', 'tat', 'vo', 'men underwear', 'boxer'] },
    ],
  },
  {
    category: 'Mỹ phẩm & Làm đẹp',
    keywords: ['beauty', 'cosmetic', 'my pham', 'makeup', 'trang diem', 'skincare', 'son', 'kem', 'serum', 'perfume', 'nuoc hoa'],
    subCategories: [
      { name: 'Skincare', keywords: ['skincare', 'duong da', 'serum', 'toner', 'kem duong', 'cleanser', 'sua rua mat', 'mask', 'mat na', 'moisturiz', 'facial', 'scrub', 'acne', 'mun', 'sunscreen', 'chong nang'] },
      { name: 'Chăm sóc da', keywords: ['duong da', 'cham soc da', 'serum', 'toner', 'kem', 'mat na', 'rua mat'] },
      { name: 'Makeup', keywords: ['makeup', 'trang diem', 'lipstick', 'son moi', 'foundation', 'kem nen', 'concealer', 'mascara', 'eyeliner', 'ke mat', 'blush', 'cushion', 'phan', 'cosmetic'] },
      { name: 'Fragrance', keywords: ['perfume', 'nuoc hoa', 'fragrance', 'eau de', 'cologne'] },
      { name: 'Haircare & Styling', keywords: ['shampoo', 'dau goi', 'conditioner', 'dau xa', 'hair care', 'haircare', 'hair oil', 'hair serum'] },
      { name: 'Hair Care & Styling', keywords: ['shampoo', 'dau goi', 'conditioner', 'dau xa', 'hair'] },
      { name: 'Bath & Body Care', keywords: ['body wash', 'sua tam', 'body lotion', 'body cream', 'shower gel', 'body scrub', 'bath soak', 'bath salt', 'soak'] },
      { name: 'Nail Art Decoration & Accessories', keywords: ['nail', 'mong tay', 'nail art', 'nail polish', 'manicure', 'temporary tattoo', 'tattoo'] },
      { name: 'Manicure & Pedicure Tools', keywords: ['nail tool', 'nail clipper', 'manicure tool', 'nail kit', 'kềm', 'mong'] },
      { name: 'Personal Care Appliances', keywords: ['hair dryer', 'may say', 'straightener', 'ep toc', 'shaver', 'dao cao', 'trimmer', 'shaving brush', 'shave brush', 'beard straightener'] },
      { name: "Men's Care", keywords: ['men grooming', 'beard', 'shaving', 'men care', 'beard oil', 'beard straightener', 'shave'] },
    ],
  },
  {
    category: 'Sức khoẻ',
    keywords: ['health', 'suc khoe', 'vitamin', 'supplement', 'thuc pham chuc nang', 'medical', 'y te'],
    subCategories: [
      { name: 'Nutrition & Wellness', keywords: ['vitamin', 'supplement', 'thuc pham chuc nang', 'omega', 'collagen', 'probiotic', 'men vi sinh', 'protein', 'detox', 'giam can', 'dietary', 'prebiotic', 'joint pain', 'muscle pain', 'relief', 'pH balance'] },
      { name: 'Medical Supplies', keywords: ['medical', 'y te', 'thermometer', 'nhiet ke', 'blood pressure', 'huyet ap', 'mask', 'khau trang', 'first aid', 'syringe', 'wart remover', 'wart', 'ice pack', 'cooling', 'patch', 'hydrocolloid'] },
      { name: 'Alternative Medications & Treatments', keywords: ['herbal', 'thao duoc', 'ointment', 'balm', 'remedy', 'therapy', 'diffuser', 'herbal diffuser', 'aromatherapy', 'detox'] },
    ],
  },
  {
    category: 'Thực phẩm & Đồ uống',
    keywords: ['food', 'thuc pham', 'do uong', 'drink', 'snack', 'banh', 'keo', 'candy', 'tra', 'ca phe', 'coffee', 'an vat'],
    subCategories: [
      { name: 'Snacks', keywords: ['snack', 'banh', 'keo', 'candy', 'gummies', 'chip', 'cookie', 'chocolate', 'an vat', 'do an vat'] },
      { name: 'Đồ ăn vặt', keywords: ['an vat', 'do an vat', 'banh', 'keo', 'snack', 'kho bo'] },
      { name: 'Drinks', keywords: ['drink', 'do uong', 'tra', 'tea', 'ca phe', 'coffee', 'cafe', 'juice', 'nuoc ngot', 'sua', 'milk', 'tra sua', 'beer', 'bia'] },
      { name: 'Baking', keywords: ['baking', 'flour', 'bot', 'cake mix', 'yeast', 'men'] },
      { name: 'Fresh & Frozen Food', keywords: ['frozen', 'fresh food', 'meat', 'seafood', 'rau', 'vegetable', 'fruit', 'trai cay'] },
      { name: 'Pantry Food', keywords: ['pantry', 'sauce', 'gia vi', 'condiment', 'oil', 'dau an', 'nuoc mam', 'rice', 'gao', 'noodle', 'mi'] },
    ],
  },
  {
    category: 'Đồ gia dụng & Nhà cửa',
    keywords: ['home', 'gia dung', 'nha cua', 'kitchen', 'nha bep', 'household', 'furniture', 'noi that', 'gadget nha'],
    subCategories: [
      { name: 'Kitchen Utensils & Gadgets', keywords: ['kitchen', 'nha bep', 'utensil', 'gadget', 'noi', 'chao', 'pan', 'pot', 'spatula', 'do nha bep', 'dutch oven', 'cast iron', 'colossal cup', 'nutribullet', 'replacement cup'] },
      { name: 'Home Appliances', keywords: ['appliance', 'may hut bui', 'vacuum', 'noi com', 'rice cooker', 'blender', 'may xay', 'microwave'] },
      { name: 'Home Decor', keywords: ['decor', 'trang tri', 'wall art', 'vase', 'lo hoa', 'candle', 'nen'] },
      { name: 'Home Organizers', keywords: ['organizer', 'hop dung', 'storage', 'ke', 'shelf', 'rack', 'zipper pouch'] },
      { name: 'Home Care Supplies', keywords: ['cleaning', 'tay rua', 'detergent', 'nuoc giat', 'mop', 'broom', 'toilet paper', 'toilet', 'bed bug', 'spray', 'insect'] },
      { name: 'Cutlery & Tableware', keywords: ['cutlery', 'dao', 'fork', 'spoon', 'tableware', 'bat', 'dia', 'plate', 'bowl', 'chopstick'] },
      { name: 'Drinkware', keywords: ['cup', 'ly', 'coc', 'bottle', 'binh nuoc', 'mug', 'tumbler', 'glass'] },
      { name: 'Bathroom Supplies', keywords: ['bathroom', 'phong tam', 'shower head', 'voi sen', 'toothbrush holder', 'towel'] },
      { name: 'Kitchen Knives', keywords: ['knife', 'dao bep', 'knives', 'dao lam bep'] },
      { name: 'Bakeware', keywords: ['bakeware', 'baking pan', 'khuon banh', 'mold'] },
      { name: 'Tea & Coffeeware', keywords: ['teapot', 'am tra', 'coffee maker', 'ca phe phin', 'tea ware', 'infuser'] },
      { name: 'Festive & Party Supplies', keywords: ['party', 'birthday', 'sinh nhat', 'decoration', 'balloon', 'bong bay'] },
      { name: 'Large Home Appliances', keywords: ['tu lanh', 'refrigerator', 'may giat', 'washing machine', 'air conditioner', 'dieu hoa'] },
      { name: 'Miscellaneous Home', keywords: ['home misc', 'household misc'] },
    ],
  },
  {
    category: 'Mẹ & Bé',
    keywords: ['baby', 'me va be', 'em be', 'tre em', 'kids', 'mother', 'sua bot', 'bim', 'ta'],
    subCategories: [
      { name: 'Baby Toys', keywords: ['baby toy', 'do choi em be', 'infant toy', 'rattle'] },
      { name: 'Nursing & Feeding', keywords: ['nursing', 'feeding', 'an dam', 'binh sua', 'baby bottle', 'breast', 'sua bot'] },
      { name: 'Baby Clothing & Shoes', keywords: ['baby clothes', 'quan ao be', 'baby shoes', 'newborn', 'so sinh', 'bim', 'ta'] },
    ],
  },
  {
    category: "Kids' Fashion",
    keywords: ['kids fashion', 'tre em', 'children clothes', 'quan ao tre em'],
    subCategories: [
      { name: "Girls' Clothes", keywords: ['girl dress', 'girl clothes', 'quan ao be gai'] },
      { name: "Boys' Clothes", keywords: ['boy clothes', 'quan ao be trai', 'boy shirt'] },
    ],
  },
  {
    category: 'Thể thao & Du lịch',
    keywords: ['sport', 'the thao', 'fitness', 'gym', 'yoga', 'outdoor', 'du lich', 'travel', 'camping', 'hiking'],
    subCategories: [
      { name: 'Sports & Outdoor Accessories', keywords: ['sport', 'the thao', 'gym', 'fitness', 'yoga', 'dumbbell', 'outdoor', 'accessories', 'jump rope', 'skipping rope', 'gym', 'fitness', 'exercise'] },
      { name: 'Leisure & Outdoor Recreation Equipment', keywords: ['recreation', 'fishing', 'cau ca', 'senar', 'fishing line', 'pancing', 'camping', 'hiking', 'leu', 'tent'] },
      { name: 'Sport & Outdoor Clothing', keywords: ['sportswear', 'ao tap', 'quan tap', 'activewear', 'giay the thao', 'sport clothing', 'running shorts', 'legging', 'fitness shorts', 'jogging'] },
      { name: 'Swimwear, Surfwear & Wetsuits', keywords: ['swimwear', 'do boi', 'bikini', 'surf', 'wetsuit'] },
      { name: 'Camping & Hiking', keywords: ['camping', 'hiking', 'leu', 'tent', 'sleeping bag', 'tui ngu', 'da ngoai'] },
    ],
  },
  {
    category: 'Shoes',
    keywords: ['shoes', 'giay', 'dep', 'sneaker', 'footwear', 'sandals', 'boots'],
    subCategories: [
      { name: "Women's Shoes", keywords: ['women shoe', 'giay nu', 'heels', 'cao got', 'sandals nu', 'boots nu'] },
      { name: 'Shoe Accessories', keywords: ['shoelace', 'day giay', 'insole', 'lot giay', 'shoe care', 'shoe accessory'] },
    ],
  },
  {
    category: 'Luggage & Bags',
    keywords: ['bag', 'tui xach', 'balo', 'backpack', 'luggage', 'vali', 'handbag', 'purse'],
    subCategories: [
      { name: "Women's Bags", keywords: ['handbag', 'tui xach', 'purse', 'shoulder bag', 'tote', 'clutch'] },
      { name: "Men's Bags", keywords: ['men bag', 'messenger', 'briefcase', 'tui nam', 'sling bag nam'] },
      { name: 'Functional Bags', keywords: ['backpack', 'balo', 'luggage', 'vali', 'travel bag', 'duffel', 'school bag', 'tui chong nuoc'] },
      { name: 'Bag Accessories', keywords: ['bag strap', 'bag organizer', 'bag charm'] },
    ],
  },
  {
    category: 'Pet Supplies',
    keywords: ['pet', 'thu cung', 'dog', 'cat', 'cho', 'meo', 'pet supplies'],
    subCategories: [
      { name: 'Dog & Cat Accessories', keywords: ['dog', 'cat', 'cho', 'meo', 'pet accessory', 'collar', 'vong co', 'leash'] },
      { name: 'Dog & Cat Food', keywords: ['dog food', 'cat food', 'pet food', 'thuc an cho', 'thuc an meo'] },
      { name: 'Dog & Cat Grooming', keywords: ['pet grooming', 'pet shampoo', 'brush pet'] },
      { name: 'Dog & Cat Furniture', keywords: ['pet bed', 'cat tree', 'pet furniture'] },
      { name: 'Bird Supplies', keywords: ['bird', 'chim', 'bird cage', 'parrot'] },
      { name: 'Small Animal Supplies', keywords: ['hamster', 'rabbit', 'small animal'] },
      { name: 'Farm Animal & Poultry Supplies', keywords: ['poultry', 'farm animal', 'chicken', 'ga'] },
    ],
  },
  {
    category: 'Automotive & Motorcycle',
    keywords: ['automotive', 'o to', 'xe may', 'motorcycle', 'car', 'xe', 'phu tung'],
    subCategories: [
      { name: 'Car Interior Accessories', keywords: ['car interior', 'noi that o to', 'car seat', 'car mat', 'car accessory'] },
      { name: 'Car Exterior Accessories', keywords: ['car exterior', 'car cover', 'vo xe', 'lop xe', 'car sticker'] },
      { name: 'Car Lights', keywords: ['car light', 'den xe', 'headlight', 'led car'] },
      { name: 'Car Repair Tools', keywords: ['car repair', 'phu tung', 'car tool', 'jack', 'wrench o to'] },
    ],
  },
  {
    category: 'Home Improvement',
    keywords: ['home improvement', 'cai tao nha', 'tool', 'dung cu', 'lighting', 'den', 'building'],
    subCategories: [
      { name: 'Lights & Lighting', keywords: ['light', 'den', 'lamp', 'led', 'lighting', 'bulb', 'bong den'] },
      { name: 'Garden Supplies', keywords: ['garden', 'vuon', 'plant', 'cay', 'pot', 'chau', 'gardening'] },
      { name: 'Building Supplies', keywords: ['building', 'vat lieu', 'paint', 'son', 'hardware'] },
      { name: 'Electrical Equipment & Supplies', keywords: ['electrical', 'socket', 'o cam', 'cable', 'wire', 'switch', 'cong tac'] },
      { name: 'Bathroom Fixtures', keywords: ['bathroom fixture', 'faucet', 'voi nuoc', 'sink'] },
      { name: 'Kitchen Fixtures', keywords: ['kitchen fixture', 'faucet bep', 'sink bep'] },
      { name: 'Smart Home Systems', keywords: ['smart home', 'home automation', 'smart plug'] },
    ],
  },
  {
    category: 'Toys & Hobbies',
    keywords: ['toy', 'do choi', 'hobby', 'game', 'puzzle', 'lego', 'diy'],
    subCategories: [
      { name: 'Games & Puzzles', keywords: ['puzzle', 'game', 'do choi', 'brain teaser', 'unlock', 'board game'] },
      { name: 'Educational Toys', keywords: ['educational', 'giao duc', 'learning toy', 'montessori'] },
      { name: 'Classic & Novelty Toys', keywords: ['toy', 'do choi', 'novelty', 'plush', 'thu bong', 'doll', 'music toy', 'vibraslap', 'exploration kit', 'bug catcher'] },
      { name: 'Sports & Outdoor Play', keywords: ['outdoor play', 'playground', 'trampoline', 'swing'] },
      { name: 'DIY', keywords: ['diy', 'craft', 'khuon', 'mold', 'kit', 'safari costume'] },
      { name: 'Musical Instruments & Accessories', keywords: ['musical', 'instrument', 'guitar', 'ukulele', 'nhac cu'] },
    ],
  },
  {
    category: 'Collectibles',
    keywords: ['collectible', 'diecast', 'model', 'trading card', 'figure', 'mo hinh'],
    subCategories: [
      { name: 'Trading Cards & Accessories', keywords: ['trading card', 'card game', 'collectible card'] },
    ],
  },
  {
    category: 'Sports & Outdoor',
    keywords: ['sport', 'outdoor', 'the thao', 'camping', 'hiking', 'fitness', 'gym', 'du lich'],
    subCategories: [
      { name: 'Sports & Outdoor Accessories', keywords: ['sport', 'outdoor', 'the thao', 'gym', 'fitness', 'dumbbell', 'yoga'] },
      { name: 'Leisure & Outdoor Recreation Equipment', keywords: ['fishing', 'cau ca', 'camping', 'hiking', 'leu', 'tent', 'recreation'] },
      { name: 'Sport & Outdoor Clothing', keywords: ['sportswear', 'activewear', 'ao tap', 'quan tap', 'giay the thao'] },
      { name: 'Camping & Hiking', keywords: ['camping', 'hiking', 'leu', 'tent', 'tui ngu', 'da ngoai'] },
      { name: 'Swimwear, Surfwear & Wetsuits', keywords: ['swimwear', 'do boi', 'bikini', 'surf', 'wetsuit'] },
    ],
  },
  {
    category: 'Computers & Office Equipment',
    keywords: ['computer', 'office', 'van phong', 'laptop', 'keyboard', 'mouse', 'stationery'],
    subCategories: [
      { name: 'Computer Accessories', keywords: ['computer', 'laptop', 'keyboard', 'ban phim', 'mouse', 'chuot', 'monitor'] },
      { name: 'Office Stationery & Supplies', keywords: ['stationery', 'van phong pham', 'pen', 'but', 'paper', 'giay', 'notebook', 'vo'] },
    ],
  },
  {
    category: 'Sách & Văn phòng phẩm',
    keywords: ['sach', 'book', 'van phong pham', 'stationery', 'vo', 'but', 'giay'],
    subCategories: [
      { name: 'Office Stationery & Supplies', keywords: ['stationery', 'van phong pham', 'pen', 'but', 'paper', 'giay', 'notebook', 'vo'] },
    ],
  },
  {
    category: 'Books, Magazines & Audio',
    keywords: ['book', 'sach', 'literature', 'magazine', 'audio'],
    subCategories: [
      { name: 'Literature & Art', keywords: ['book', 'sach', 'novel', 'tieu thuyet', 'literature', 'truyen'] },
      { name: 'Video & Music', keywords: ['music', 'video', 'audio', 'cd', 'vinyl'] },
      { name: 'Humanities & Social Sciences', keywords: ['humanities', 'social science', 'giao trinh', 'textbook'] },
    ],
  },
  {
    category: 'Textiles & Soft Furnishings',
    keywords: ['textile', 'fabric', 'vai', 'linen', 'chan', 'ga', 'goi', 'bedding'],
    subCategories: [
      { name: 'Bedding and Linens', keywords: ['bedding', 'chan', 'ga', 'goi', 'nem', 'linen', 'bed sheet', 'duvet'] },
      { name: 'Household Textiles', keywords: ['towel', 'khan', 'curtain', 'rem', 'cushion cover', 'vo goi'] },
    ],
  },
  {
    category: 'Furniture',
    keywords: ['furniture', 'noi that', 'sofa', 'ban', 'ghe', 'tu', 'ke', 'chair', 'table'],
    subCategories: [
      { name: 'Indoor Furniture', keywords: ['furniture', 'noi that', 'sofa', 'ban', 'ghe', 'chair', 'table', 'tu', 'ke'] },
    ],
  },
  {
    category: 'Tools & Hardware',
    keywords: ['tool', 'dung cu', 'hardware', 'wrench', 'screwdriver', 'khoan'],
    subCategories: [
      { name: 'Hand Tools', keywords: ['hand tool', 'wrench', 'screwdriver', 'khoan', 'hammer', 'bua', 'dung cu'] },
      { name: 'Measuring Tools', keywords: ['measuring', 'do luong', 'ruler', 'thuoc', 'tape measure'] },
    ],
  },
  {
    category: 'Modest Fashion',
    keywords: ['modest', 'hijab', 'muslim wear'],
    subCategories: [
      { name: 'Hijabs', keywords: ['hijab', 'khăn trùm', 'scarf muslim', 'tudung'] },
    ],
  },
  {
    category: 'Menaje de cocina',
    keywords: ['cocina', 'cocina menaje', 'kitchen espanol', 'barbacoa'],
    subCategories: [
      { name: 'Barbacoa', keywords: ['barbacoa', 'barbecue', 'bbq', 'asado'] },
    ],
  },
  {
    category: 'Belleza y cuidado personal',
    keywords: ['belleza', 'cuidado personal', 'maquillaje'],
    subCategories: [
      { name: 'Aparatos para el cuidado personal', keywords: ['aparato', 'cuidado personal', 'secador'] },
      { name: 'Maquillaje', keywords: ['maquillaje', 'cosmetico', 'labial'] },
    ],
  },
  {
    category: 'Công nghệ & Gia dụng',
    keywords: ['cong nghe', 'gia dung', 'tech', 'dien tu'],
    subCategories: [],
  },
];
