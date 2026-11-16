import { createHash } from 'node:crypto';
import { datasetDb as db } from '../../config/datasetDb.js';
import type { Prisma } from '../../../generated/v2/index.js';
import { allocateInteger, simulateSeries } from './simulationEngine.js';
import { affiliateShare, ensureSyntheticEntities, planSyntheticEntities, shareWeights, sourceMetadata } from './syntheticEntityService.js';

export const SIMULATED_ENTITIES_SOURCE = 'simulated:sim-entities-v1';
type Row = Prisma.MetricSnapshotCreateManyInput;
type DayAcc = { units: number; gmv: number; activity: number; affiliateUnits: number; affiliateGmv: number };
const money = (n: number) => Math.round(n * 100) / 100;
function hash32(key: string): number { return createHash('sha256').update(key).digest().readUInt32LE(0); }

/** Idempotently generate separate simulated Shop/Creator entities and histories. */
export async function generateSyntheticEntityHistory(days = 90) {
  const plans = await planSyntheticEntities();
  const entities = await ensureSyntheticEntities(plans);
  const rows: Row[] = [];
  const push = (entityType: string, entityId: number, metric: string, value: number, currency: string | null, date: string, metadata: Record<string, unknown>) => {
    rows.push({ entityType, entityId, metric, value: String(value), currency, bucketDate: new Date(date + 'T00:00:00.000Z'), source: SIMULATED_ENTITIES_SOURCE, verificationStatus: 'NEEDS_REVIEW', isEstimated: true, observedAt: new Date(), metadata: metadata as Prisma.InputJsonValue });
  };
  const shopTotals = new Map<number, Map<string, DayAcc>>();
  const creatorTotals = new Map<number, Map<string, DayAcc>>();
  let products = 0, productShopSnapshots = 0, productCreatorSnapshots = 0;
  const end = new Date();

  for (const plan of plans) {
    const productKey = `product:${plan.productId}`;
    const series = simulateSeries({ scenario: plan.scenario, anchorSold: plan.anchorSold, anchorPrice: plan.anchorPrice }, days, end, productKey);
    const shops = entities.shopsByProduct.get(plan.productId) ?? [];
    const creators = entities.creatorsByProduct.get(plan.productId) ?? [];
    const creatorShopLinks = entities.creatorShopsByProduct.get(plan.productId) ?? [];
    const shopIds = shops.map((x) => x.shopId);
    const creatorIds = creators.map((x) => x.creatorId);
    const meta = sourceMetadata(plan, productKey, { mode: 'SIMULATION', windowDays: days, anchorSource: 'ProductObservation', anchorSold: plan.anchorSold, anchorPrice: plan.anchorPrice });
    const creatorCum = new Map<number, DayAcc>();
    const shopProductCum = new Map<number, DayAcc>();
    let affiliateSold = 0, affiliateGmv = 0;

    for (let day = 0; day < series.length; day++) {
      const p = series[day]!;
      push('PRODUCT', plan.productId, 'soldCount', p.soldCount, null, p.bucketDate, meta);
      push('PRODUCT', plan.productId, 'price', p.price, plan.currency, p.bucketDate, meta);
      push('PRODUCT', plan.productId, 'gmv', p.gmv, plan.currency, p.bucketDate, meta);

      const shares = shareWeights(plan.productId, shopIds, day, plan.marketStructure);
      const shopUnits = allocateInteger(p.dailyUnits, shares);
      const shopDayGmv = shopUnits.map((u) => money(u * p.price));
      if (shares.length) {
        push('PRODUCT', plan.productId, 'topShopShare', Math.max(...shares), null, p.bucketDate, { ...meta, marketStructure: plan.marketStructure, shopCount: shares.length, shopIds, shopShares: Object.fromEntries(shopIds.map((id, i) => [String(id), shares[i]])) });
        push('PRODUCT', plan.productId, 'concentrationHhi', shares.reduce((sum, x) => sum + x * x, 0), null, p.bucketDate, { ...meta, marketStructure: plan.marketStructure, shopCount: shares.length });
        push('PRODUCT', plan.productId, 'sellerCount', shares.length, null, p.bucketDate, { ...meta, marketStructure: plan.marketStructure });
      }

      for (let s = 0; s < shops.length; s++) {
        const rel = shops[s]!;
        const units = shopUnits[s] ?? 0, gmv = shopDayGmv[s] ?? 0;
        const cum = shopProductCum.get(rel.relationId) ?? { units: 0, gmv: 0, activity: 0, affiliateUnits: 0, affiliateGmv: 0 };
        cum.units += units; cum.gmv += gmv; shopProductCum.set(rel.relationId, cum);
        const relMeta = { ...meta, shopId: rel.shopId, productShopId: rel.relationId, dailyShare: shares[s] ?? 0 };
        push('PRODUCT_SHOP', rel.relationId, 'soldCount', cum.units, null, p.bucketDate, relMeta);
        push('PRODUCT_SHOP', rel.relationId, 'gmv', money(cum.gmv), plan.currency, p.bucketDate, relMeta);
        push('PRODUCT_SHOP', rel.relationId, 'price', p.price, plan.currency, p.bucketDate, relMeta);
        const total = shopTotals.get(rel.shopId) ?? new Map<string, DayAcc>();
        const d = total.get(p.bucketDate) ?? { units: 0, gmv: 0, activity: 0, affiliateUnits: 0, affiliateGmv: 0 };
        d.units += units; d.gmv += gmv; total.set(p.bucketDate, d); shopTotals.set(rel.shopId, total);
        productShopSnapshots += 3;
      }

      // Affiliate units are allocated from each shop's sales to creators explicitly
      // linked to that shop; total attribution can never exceed product or shop units.
      const creatorUnits = new Map<number, number>();
      for (let s = 0; s < shops.length; s++) {
        const shopId = shops[s]!.shopId;
        const available = shopUnits[s] ?? 0;
        if (available <= 0) continue;
        const linkedCreators = creatorShopLinks.filter((r) => r.shopId === shopId).map((r) => r.creatorId);
        if (!linkedCreators.length) continue;
        const amount = Math.min(available, Math.round(available * affiliateShare(plan, day, series.length)));
        const portions = allocateInteger(amount, linkedCreators.map((id) => 0.75 + (hash32(`${plan.productId}:${id}`) % 1000) / 1000));
        linkedCreators.forEach((id, i) => creatorUnits.set(id, (creatorUnits.get(id) ?? 0) + (portions[i] ?? 0)));
        const shopAcc = shopTotals.get(shopId)!.get(p.bucketDate)!;
        shopAcc.affiliateUnits += amount;
        shopAcc.affiliateGmv += amount * p.price;
      }
      const affiliateDaily = [...creatorUnits.values()].reduce((sum, n) => sum + n, 0);
      const affiliateDailyGmv = money(affiliateDaily * p.price);
      affiliateSold += affiliateDaily; affiliateGmv += affiliateDailyGmv;
      const rate = p.dailyUnits > 0 ? affiliateDaily / p.dailyUnits : 0;
      push('PRODUCT', plan.productId, 'affiliateSold', affiliateSold, null, p.bucketDate, { ...meta, affiliateRate: rate, affiliateProfile: plan.affiliateProfile });
      push('PRODUCT', plan.productId, 'affiliateGmv', money(affiliateGmv), plan.currency, p.bucketDate, { ...meta, affiliateRate: rate, affiliateProfile: plan.affiliateProfile });
      push('PRODUCT', plan.productId, 'affiliateShare', rate, null, p.bucketDate, { ...meta, affiliateProfile: plan.affiliateProfile });

      for (const [creatorId, units] of creatorUnits) {
        const gmv = money(units * p.price), activity = units > 0 ? 1 + hash32(`${creatorId}:${p.bucketDate}`) % 3 : 0;
        const cum = creatorCum.get(creatorId) ?? { units: 0, gmv: 0, activity: 0, affiliateUnits: 0, affiliateGmv: 0 };
        cum.units += units; cum.gmv += gmv; cum.activity += activity; creatorCum.set(creatorId, cum);
        const link = creators.find((x) => x.creatorId === creatorId);
        if (!link) continue;
        const creatorMeta = { ...meta, creatorId, productCreatorId: link.relationId, affiliateRate: rate, contributionScope: 'subset_of_linked_shop_sales' };
        push('CREATOR', creatorId, 'soldCount', cum.units, null, p.bucketDate, creatorMeta);
        push('CREATOR', creatorId, 'gmv', money(cum.gmv), plan.currency, p.bucketDate, creatorMeta);
        push('CREATOR', creatorId, 'activityCount', cum.activity, null, p.bucketDate, creatorMeta);
        push('PRODUCT_CREATOR', link.relationId, 'soldCount', cum.units, null, p.bucketDate, creatorMeta);
        push('PRODUCT_CREATOR', link.relationId, 'gmv', money(cum.gmv), plan.currency, p.bucketDate, creatorMeta);
        push('PRODUCT_CREATOR', link.relationId, 'activityCount', cum.activity, null, p.bucketDate, creatorMeta);
        const total = creatorTotals.get(creatorId) ?? new Map<string, DayAcc>();
        const d = total.get(p.bucketDate) ?? { units: 0, gmv: 0, activity: 0, affiliateUnits: 0, affiliateGmv: 0 };
        d.units += units; d.gmv += gmv; d.activity += activity; total.set(p.bucketDate, d); creatorTotals.set(creatorId, total);
        productCreatorSnapshots += 3;
      }
    }
    products++;
  }

  for (const [shopId, byDay] of shopTotals) {
    let sold = 0, gmv = 0, affiliateSold = 0, affiliateGmv = 0;
    for (const [date, daily] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      sold += daily.units; gmv += daily.gmv; affiliateSold += daily.affiliateUnits; affiliateGmv += daily.affiliateGmv;
      const metadata = { sourceType: 'SIMULATED', generationVersion: 'sim-entities-v1', mode: 'SIMULATION', shopId, reconcilesFromProductShop: true, generatedAt: new Date().toISOString() };
      push('SHOP', shopId, 'productSoldCount', sold, null, date, metadata);
      push('SHOP', shopId, 'productGmv', money(gmv), null, date, metadata);
      push('SHOP', shopId, 'affiliateSold', affiliateSold, null, date, metadata);
      push('SHOP', shopId, 'affiliateGmv', money(affiliateGmv), null, date, metadata);
    }
  }
  for (const [creatorId, byDay] of creatorTotals) {
    let sold = 0, gmv = 0, activity = 0;
    for (const [date, daily] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      sold += daily.units; gmv += daily.gmv; activity += daily.activity;
      const metadata = { sourceType: 'SIMULATED', generationVersion: 'sim-entities-v1', mode: 'SIMULATION', creatorId, contributionScope: 'subset_of_linked_product_sales', generatedAt: new Date().toISOString() };
      push('CREATOR', creatorId, 'soldCount', sold, null, date, metadata);
      push('CREATOR', creatorId, 'gmv', money(gmv), null, date, metadata);
      push('CREATOR', creatorId, 'activityCount', activity, null, date, metadata);
    }
  }

  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) await db.metricSnapshot.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true });
  return { products, syntheticShops: entities.shopsCreatedOrFound, syntheticCreators: entities.creatorsCreatedOrFound, productShopLinks: entities.productShopLinks, productCreatorLinks: entities.productCreatorLinks, creatorShopLinks: entities.creatorShopLinks, productShopSnapshots: productShopSnapshots, productCreatorSnapshots, totalSnapshotRows: rows.length };
}
