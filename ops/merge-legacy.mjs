import pg from 'pg';
import { createHash } from 'node:crypto';

const MAIN = 'postgresql://postgres:123456@127.0.0.1:5432/tiktok_datasets_v2';
const LEGACY = 'postgresql://postgres:123456@127.0.0.1:5432/tiktok_analytics';

const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const main = new pg.Client({ connectionString: MAIN });
const legacy = new pg.Client({ connectionString: LEGACY });
await main.connect();
await legacy.connect();

let report = {};

try {
  await main.query('BEGIN');

  // 1. Ensure provenance DataSource + DatasetFile + a RawRecord per legacy entity.
  let ds = await main.query(`SELECT id FROM "DataSource" WHERE code='echotik-vn-legacy'`);
  let dsId;
  if (ds.rowCount === 0) {
    dsId = (await main.query(`INSERT INTO "DataSource" (code, name, "usageRestriction", "licenseNote") VALUES ('echotik-vn-legacy','EchoTik VN legacy','UNVERIFIED','Migrated from legacy tiktok_analytics DB') RETURNING id`)).rows[0].id;
  } else dsId = ds.rows[0].id;

  const fileSha = hash('echotik-vn-legacy-merge');
  let file = await main.query(`SELECT id FROM "DatasetFile" WHERE "sourceId"=$1 AND sha256=$2`, [dsId, fileSha]);
  let fileId;
  if (file.rowCount === 0) {
    fileId = (await main.query(`INSERT INTO "DatasetFile" ("sourceId", "relativePath", sha256, format, "recordCount") VALUES ($1,$2,$3,'ECHOTIK_VN_LEGACY',0) RETURNING id`, [dsId, 'legacy/echotik-vn', fileSha])).rows[0].id;
  } else fileId = file.rows[0].id;

  async function ensureRawRecord(payload) {
    const rn = (await main.query(`SELECT coalesce(max("recordNumber"),0) AS m FROM "RawRecord" WHERE "datasetFileId"=$1`, [fileId])).rows[0].m + 1;
    const r = await main.query(`INSERT INTO "RawRecord" ("datasetFileId", "recordNumber", payload, issues, state, "normalizerVersion") VALUES ($1,$2,$3,'[]','NORMALIZED','legacy-merge-v1') RETURNING id`, [fileId, rn, JSON.stringify(payload)]);
    return r.rows[0].id;
  }

  // 2. Merge categories (dedup by name).
  const mainCats = new Map((await main.query(`SELECT id, name, slug FROM "Category"`)).rows.map(r => [r.name, r]));
  const legCats = (await legacy.query(`SELECT id, name FROM "Category" ORDER BY id`)).rows;
  let catAdded = 0;
  const legCatToMain = new Map();
  for (const c of legCats) {
    if (mainCats.has(c.name)) { legCatToMain.set(c.id, mainCats.get(c.name).id); continue; }
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('cat-' + c.id);
    let existing = await main.query(`SELECT id FROM "Category" WHERE slug=$1`, [slug]);
    if (existing.rowCount > 0) {
      legCatToMain.set(c.id, existing.rows[0].id); continue;
    }
    const nr = await main.query(`INSERT INTO "Category" (name, slug) VALUES ($1,$2) RETURNING id`, [c.name, slug]);
    legCatToMain.set(c.id, nr.rows[0].id);
    catAdded++;
  }

  // 3. Merge subcategories (dedup by (categoryId,name)).
  const mainSubs = new Set((await main.query(`SELECT s."categoryId", s.name FROM "SubCategory" s`)).rows.map(r => `${r.categoryId}:${r.name}`));
  const legSubs = (await legacy.query(`SELECT id, "categoryId", name FROM "SubCategory" ORDER BY id`)).rows;
  let subAdded = 0;
  const legSubToMain = new Map();
  for (const s of legSubs) {
    const mainCatId = legCatToMain.get(s.categoryId);
    if (mainCatId === undefined) continue;
    if (mainSubs.has(`${mainCatId}:${s.name}`)) continue;
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || ('sub-' + s.id);
    const nr = await main.query(`INSERT INTO "SubCategory" ("categoryId", name, slug) VALUES ($1,$2,$3) RETURNING id`, [mainCatId, s.name, slug]);
    legSubToMain.set(s.id, nr.rows[0].id);
    mainSubs.add(`${mainCatId}:${s.name}`);
    subAdded++;
  }

  // 4. Merge shops (identity via ExternalIdentity tiktok:shop).
  const legShops = (await legacy.query(`SELECT * FROM "Shop" ORDER BY id`)).rows;
  const legShopToMain = new Map();
  let shopAdded = 0;
  for (const s of legShops) {
    let ident = await main.query(`SELECT "shopId" FROM "ExternalIdentity" WHERE namespace='tiktok:shop' AND "externalId"=$1 AND "shopId" IS NOT NULL`, [s.platformShopId]);
    if (ident.rowCount > 0) { legShopToMain.set(s.id, ident.rows[0].shopId); continue; }
    const nr = await main.query(`INSERT INTO "Shop" (name, "shopUrl", "avatarUrl", market, "processingState", "isSimulated", "simulationMetadata") VALUES ($1,$2,$3,'VN','NEEDS_DATA',false,$4) RETURNING id`, [s.name, s.shopUrl, s.avatarUrl, JSON.stringify({ legacySource: s.source, platformShopId: s.platformShopId, legacyId: s.id })]);
    const newId = nr.rows[0].id;
    const rid = await ensureRawRecord({ kind: 'shop', legacyShopId: s.id, platformShopId: s.platformShopId, source: s.source });
    await main.query(`INSERT INTO "ExternalIdentity" (namespace, "externalId", "shopId", "rawRecordId", "verificationStatus") VALUES ('tiktok:shop',$1,$2,$3,'VERIFIED')`, [s.platformShopId, newId, rid]);
    await main.query(`INSERT INTO "ShopObservation" ("shopId", "rawRecordId", "followerCount", "productCount", "ratingScore", quality) VALUES ($1,$2,$3,$4,$5,$6)`, [newId, rid, s.followerCount, s.productCount, s.ratingScore, JSON.stringify({ legacySource: s.source, observedAt: s.lastSeenAt?.toISOString?.() ?? null })]);
    legShopToMain.set(s.id, newId);
    shopAdded++;
  }

  // 5. Merge products (identity via ExternalIdentity tiktok:product).
  const legProducts = (await legacy.query(`SELECT * FROM "Product" ORDER BY id`)).rows;
  const legProductToMain = new Map();
  let productAdded = 0;
  for (const p of legProducts) {
    let ident = await main.query(`SELECT "productId" FROM "ExternalIdentity" WHERE namespace='tiktok:product' AND "externalId"=$1 AND "productId" IS NOT NULL`, [p.platformProductId]);
    if (ident.rowCount > 0) { legProductToMain.set(p.id, ident.rows[0].productId); continue; }
    const currency = p.currency || 'VND';
    const nr = await main.query(`INSERT INTO "Product" (title, description, "productUrl", "imageUrl", market, currency, "processingState") VALUES ($1,$2,$3,$4,'VN',$5,'NEEDS_DATA') RETURNING id`, [p.title, p.description, p.productUrl, p.imageUrl, currency]);
    const newId = nr.rows[0].id;
    const rid = await ensureRawRecord({ kind: 'product', legacyProductId: p.id, platformProductId: p.platformProductId, source: p.source });
    await main.query(`INSERT INTO "ExternalIdentity" (namespace, "externalId", "productId", "rawRecordId", "verificationStatus") VALUES ('tiktok:product',$1,$2,$3,'VERIFIED')`, [p.platformProductId, newId, rid]);
    await main.query(`INSERT INTO "ProductObservation" ("productId", "rawRecordId", price, "originalPrice", currency, "soldCount", "ratingScore", "ratingCount", "isAvailable", quality) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [newId, rid, p.minPrice, p.minOriginalPrice, currency, p.soldCount, p.ratingScore, p.ratingCount, p.isAvailable, JSON.stringify({ legacySource: p.source, observedAt: p.lastSeenAt?.toISOString?.() ?? null, minPrice: p.minPrice, maxPrice: p.maxPrice, sellerCount: p.sellerCount })]);
    legProductToMain.set(p.id, newId);
    productAdded++;
  }

  // 6. Merge ProductSnapshot -> MetricSnapshot (1 day, source echotik, VERIFIED).
  let productSnapshots = 0;
  const psRows = (await legacy.query(`SELECT * FROM "ProductSnapshot"`)).rows;
  for (const s of psRows) {
    const newProductId = legProductToMain.get(s.productId);
    if (newProductId === undefined) continue;
    const date = new Date(s.bucketDate).toISOString().slice(0, 10);
    const metrics = [
      ['soldCount', s.soldCountTotal],
      ['gmv', s.gmvTotal],
      ['price', s.price],
    ];
    for (const [metric, value] of metrics) {
      if (value === null || value === undefined) continue;
      await main.query(`INSERT INTO "MetricSnapshot" ("entityType","entityId",metric,value,currency,"observedAt","bucketDate",source,"verificationStatus",confidence,"isEstimated",metadata) VALUES ('PRODUCT',$1,$2,$3,$4,now(),$5,'echotik','VERIFIED',100,false,$6) ON CONFLICT DO NOTHING`, [newProductId, metric, String(value), s.currency || 'VND', date, JSON.stringify({ legacyProductSnapshotId: s.id, legacySource: s.source })]);
      productSnapshots++;
    }
  }

  // 7. Merge ShopRevenueSnapshot -> MetricSnapshot (source echotik, VERIFIED).
  let shopSnapshots = 0;
  const srRows = (await legacy.query(`SELECT * FROM "ShopRevenueSnapshot"`)).rows;
  for (const s of srRows) {
    const newShopId = legShopToMain.get(s.shopId);
    if (newShopId === undefined) continue;
    const date = new Date(s.bucketDate).toISOString().slice(0, 10);
    const metrics = [
      ['gmv', s.gmvTotal],
      ['soldCount', s.soldCountTotal],
    ];
    for (const [metric, value] of metrics) {
      if (value === null || value === undefined) continue;
      await main.query(`INSERT INTO "MetricSnapshot" ("entityType","entityId",metric,value,currency,"observedAt","bucketDate",source,"verificationStatus",confidence,"isEstimated",metadata) VALUES ('SHOP',$1,$2,$3,$4,now(),$5,'echotik','VERIFIED',100,false,$6) ON CONFLICT DO NOTHING`, [newShopId, metric, String(value), 'VND', date, JSON.stringify({ legacyShopRevenueSnapshotId: s.id, legacySource: s.source })]);
      shopSnapshots++;
    }
  }

  report = { categoriesAdded: catAdded, subcategoriesAdded: subAdded, shopsAdded: shopAdded, productsAdded: productAdded, productSnapshots, shopSnapshots };

  await main.query('COMMIT');
  console.log(JSON.stringify({ result: 'MERGED', ...report }));
} catch (e) {
  await main.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  await main.end();
  await legacy.end();
}
