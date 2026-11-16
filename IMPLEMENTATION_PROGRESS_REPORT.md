# ECHOTIK REAL DATA IMPLEMENTATION — PROGRESS REPORT

**Date:** 2026-11-06  
**Mission:** Build real data foundation for entire website from EchoTik API  
**Status:** ✅ PHASE 1 — 40% complete

---

## ✅ COMPLETED

### PHASE 1a: API & Schema Verification
- ✅ Verified 5 EchoTik endpoints available
- ✅ Confirmed quota: 46 calls remaining (out of 50/month)
- ✅ Identified data limitations (no creator/affiliate/video/ranking endpoints)

### PHASE 1c: Schema Migration
- ✅ Added `source` field to Shop, Product, Creator models
- ✅ Changed unique constraints from single field to composite (platformId, source)
- ✅ Added echotikMetadata JSON field to Shop for EchoTik-specific data
- ✅ Migration applied to PostgreSQL successfully

### PHASE 1b: ETL Infrastructure Design
- ✅ Designed pagination + resume strategy
- ✅ Planned source tracking (avoid overwriting Apify data)
- ✅ Planned snapshot-based historical tracking

---

## 🔄 IN PROGRESS

### PHASE 1e: Category Ingestion Service
**Files created:**
- ✨ `src/services/echotik/echoTikCategoryIngestionService.ts` (126 lines)
  - Fetch L1 categories (1 API call)
  - For each L1, fetch L2 categories (N API calls)
  - Upsert to Category + SubCategory tables
  - Error handling + logging
  - Quota tracking

**Functions:**
```typescript
export async function ingestEchoTikCategories(): Promise<CategoryIngestionResult>
```

**Deliverable:** Categories table populated from EchoTik API

---

## 📋 TODO (IMMEDIATE NEXT)

### PHASE 1d: Shop Full Ingestion Service (HIGH PRIORITY)
**Scope:** Fetch all shops (not just 10) with pagination

**Implementation steps:**
1. Create `src/services/echotik/echoTikShopFullIngestionService.ts`
   - Accept maxPages parameter (default 50 for ~1000 shops)
   - Loop through pages with error recovery
   - Normalize shop data
   - Handle source tracking (differentiate Apify vs EchoTik)
   - Create ShopRevenueSnapshot for daily tracking
   - Upsert to Shop table

2. Key logic:
```typescript
async function ingestEchoTikShopsFullDataset(maxPages = 50, pageSize = 20) {
  for (let page = 1; page <= maxPages; page++) {
    const response = await echotikClient.getSellerList(page, pageSize, 'VN');
    const sellers = extractSellerRows(response);
    
    for (const seller of sellers) {
      // Find existing by platformShopId + source
      const existing = await prisma.shop.findFirst({
        where: {
          platformShopId: seller.seller_id,
          source: 'echotik'
        }
      });
      
      if (existing) {
        // Update EchoTik-specific fields only
      } else {
        // Create new shop with source='echotik'
      }
      
      // Create ShopRevenueSnapshot
      await prisma.shopRevenueSnapshot.upsert({
        where: { shopId_source_bucketDate: {...} },
        create: { gmvTotal, soldCountTotal, source: 'echotik', ... }
      });
    }
  }
}
```

3. Testing:
   - Run with maxPages=2 first (safe)
   - Verify shops created in DB
   - Verify ShopRevenueSnapshot populated
   - Confirm no Apify shops modified

**Estimated quota cost:** 10 calls (pagination)

---

### PHASE 1f: Product Full Ingestion Service
Similar to shop ingestion but for products
- Fetch product/list with pagination
- Link to shops via seller_id
- Create ProductSnapshot with source='echotik'

**Estimated quota cost:** 10 calls

---

### PHASE 2a-2b: Backend API + Frontend Integration
After data ingestion:
1. Create API endpoints for rankings, search, filtering
2. Connect 14 frontend pages to real data
3. Remove mock data

---

## 📊 QUOTA PLAN

```
Used so far:        4 calls (testing phase)
Category ingestion: 2-3 calls (depends on L2 categories count)
Shop ingestion:     ~10 calls (assuming 50 pages × 20 items)
Product ingestion:  ~10 calls
Remaining buffer:   23+ calls
────────────────────────────────
Total:              50 calls
```

**Status:** ✅ On track for full data ingestion within quota

---

## 🚀 NEXT ACTIONS

1. **Complete PHASE 1d** (TODAY)
   - Implement shop full ingestion
   - Test with maxPages=2
   - Verify data in PostgreSQL
   - Mark todo as completed

2. **Complete PHASE 1e/1f** (TOMORROW)
   - Product ingestion
   - Final verification

3. **PHASE 2** (After data is ready)
   - Backend API endpoints
   - Frontend integration
   - Remove mock data

---

## 📝 DATA QUALITY CHECKPOINTS

After each phase:
1. Verify row counts in PostgreSQL
2. Check for NULL values in critical fields
3. Verify foreign key relationships
4. Confirm no data from Apify was modified
5. Test pagination resume capability

---

## ⚠️ KNOWN ISSUES & MITIGATIONS

| Issue | Mitigation |
|-------|-----------|
| GMV units unknown (USD/VND/CNY) | Store as-is, document in API response |
| IFL fields undefined | Store in rawData/metadata, don't use for rankings |
| Product ID match with Apify uncertain | Will verify after first ingestion |
| Revenue breakdown not available | Use total_sale_gmv_amt only, document limitation |

---

## 📈 SUCCESS CRITERIA (END OF PHASE 1)

- [ ] Shop table: 500+ records with source='echotik'
- [ ] Product table: 1000+ records with source='echotik'
- [ ] Category table: 100+ L1 + 500+ L2 categories
- [ ] ShopRevenueSnapshot: populated for each shop
- [ ] ProductSnapshot: populated for each product
- [ ] No Apify data lost or modified
- [ ] API quota used: <50 calls/month
- [ ] All services handle errors gracefully
- [ ] Resume capability tested

---

## 🎯 FINAL DELIVERABLE (END OF FULL MISSION)

- ✅ PostgreSQL with real EchoTik data (not mock)
- ✅ Backend API returning real data
- ✅ All 14 frontend pages using real data
- ✅ Historical charts with actual snapshots
- ✅ Rankings calculated from real data
- ✅ Search/filter working on real data
- ✅ Documentation of data mapping & limitations

---

**ETA to completion:** 5-7 days (if no blockers)  
**Risk level:** LOW (schema safe, no data deletion, resumable operations)  
**Impact:** HIGH (entire website data foundation)

