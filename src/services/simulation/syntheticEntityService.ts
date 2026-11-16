import { createHash } from 'node:crypto';
import { datasetDb as db } from '../../config/datasetDb.js';
import { affiliateProfileForKey, marketStructureForKey, scenarioForKey, syntheticCreatorCountForKey, syntheticShopCountForKey, type Scenario } from './simulationEngine.js';

const sourceMeta = (key: string, scenario: Scenario, extra: Record<string, unknown> = {}) => ({
  sourceType: 'SIMULATED', generationVersion: 'sim-entities-v1', generatedAt: new Date().toISOString(), seedKey: key, scenario, ...extra,
});
const hashNumber = (key: string) => createHash('sha256').update(key).digest().readUInt32LE(0);

export interface SyntheticEntityPlan {
  productId: number;
  anchorSold: number;
  anchorPrice: number;
  currency: string | null;
  scenario: Scenario;
  shopCount: number;
  creatorCount: number;
  marketStructure: ReturnType<typeof marketStructureForKey>;
  affiliateProfile: ReturnType<typeof affiliateProfileForKey>;
}

export async function planSyntheticEntities(): Promise<SyntheticEntityPlan[]> {
  const products = await db.product.findMany({
    select: { id: true, currency: true, observations: { orderBy: [{ observedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }], take: 1 } },
    orderBy: { id: 'asc' },
  });
  return products.flatMap((product) => {
    const observation = product.observations[0];
    if (!observation || observation.soldCount === null || observation.price === null) return [];
    const anchorSold = Number(observation.soldCount), anchorPrice = Number(observation.price);
    if (!Number.isSafeInteger(anchorSold) || anchorSold < 0 || !Number.isFinite(anchorPrice) || anchorPrice <= 0) return [];
    const key = `product:${product.id}`;
    return [{
      productId: product.id, anchorSold, anchorPrice, currency: observation.currency ?? product.currency,
      scenario: scenarioForKey(key), shopCount: syntheticShopCountForKey(key),
      creatorCount: syntheticCreatorCountForKey(key), marketStructure: marketStructureForKey(key),
      affiliateProfile: affiliateProfileForKey(key),
    }];
  });
}

/** Stable simulationKey upserts. Synthetic relationships are never VERIFIED. */
export async function ensureSyntheticEntities(plans: SyntheticEntityPlan[]) {
  const shopCreates: Array<{ name: string; market: string; isSimulated: boolean; simulationKey: string; simulationMetadata: ReturnType<typeof sourceMeta> }> = [];
  const creatorCreates: Array<{ displayName: string; verificationStatus: 'NEEDS_REVIEW'; isSimulated: boolean; simulationKey: string; simulationMetadata: ReturnType<typeof sourceMeta> }> = [];
  for (const plan of plans) {
    for (let slot = 0; slot < plan.shopCount; slot++) {
      const key = `sim-shop-v1:p${plan.productId}:s${slot}`;
      shopCreates.push({ name: `[SIM] Shop ${String(plan.productId).slice(-4)}-${slot + 1}`, market: 'SIMULATION', isSimulated: true, simulationKey: key, simulationMetadata: sourceMeta(key, plan.scenario, { productId: plan.productId, marketStructure: plan.marketStructure }) });
    }
    for (let slot = 0; slot < plan.creatorCount; slot++) {
      const key = `sim-creator-v1:p${plan.productId}:c${slot}`;
      creatorCreates.push({ displayName: `[SIM] Creator ${String(plan.productId).slice(-4)}-${slot + 1}`, verificationStatus: 'NEEDS_REVIEW', isSimulated: true, simulationKey: key, simulationMetadata: sourceMeta(key, plan.scenario, { productId: plan.productId, affiliateProfile: plan.affiliateProfile }) });
    }
  }
  for (let i = 0; i < shopCreates.length; i += 2000) await db.shop.createMany({ data: shopCreates.slice(i, i + 2000), skipDuplicates: true });
  for (let i = 0; i < creatorCreates.length; i += 2000) await db.creator.createMany({ data: creatorCreates.slice(i, i + 2000), skipDuplicates: true });

  const shopKeys = shopCreates.map((r) => r.simulationKey);
  const creatorKeys = creatorCreates.map((r) => r.simulationKey);
  const [shopRows, creatorRows] = await Promise.all([
    db.shop.findMany({ where: { simulationKey: { in: shopKeys } }, select: { id: true, simulationKey: true } }),
    db.creator.findMany({ where: { simulationKey: { in: creatorKeys } }, select: { id: true, simulationKey: true } }),
  ]);
  const shopByKey = new Map(shopRows.map((r) => [r.simulationKey!, r.id]));
  const creatorByKey = new Map(creatorRows.map((r) => [r.simulationKey!, r.id]));

  const shopLinks: Array<{ productId: number; shopId: number; isActive: boolean; verificationStatus: 'NEEDS_REVIEW'; isSimulated: boolean; simulationMetadata: ReturnType<typeof sourceMeta> }> = [];
  const creatorLinks: Array<{ productId: number; creatorId: number; verificationStatus: 'NEEDS_REVIEW'; isSimulated: boolean; simulationMetadata: ReturnType<typeof sourceMeta> }> = [];
  const creatorShopLinks: Array<{ creatorId: number; shopId: number; verificationStatus: 'NEEDS_REVIEW'; isSimulated: boolean; simulationMetadata: ReturnType<typeof sourceMeta> }> = [];
  const shopsByProduct = new Map<number, Array<{ shopId: number; relationId: number }>>();
  const creatorsByProduct = new Map<number, Array<{ creatorId: number; relationId: number }>>();
  const creatorShopsByProduct = new Map<number, Array<{ creatorId: number; shopId: number }>>();

  for (const plan of plans) {
    const shops: Array<{ shopId: number; relationId: number }> = [];
    for (let slot = 0; slot < plan.shopCount; slot++) {
      const key = `sim-shop-v1:p${plan.productId}:s${slot}`;
      const shopId = shopByKey.get(key);
      if (shopId !== undefined) {
        shopLinks.push({ productId: plan.productId, shopId, isActive: true, verificationStatus: 'NEEDS_REVIEW', isSimulated: true, simulationMetadata: sourceMeta(key, plan.scenario, { marketStructure: plan.marketStructure }) });
        shops.push({ shopId, relationId: 0 });
      }
    }
    const creators: Array<{ creatorId: number; relationId: number }> = [];
    const creatorShops: Array<{ creatorId: number; shopId: number }> = [];
    for (let slot = 0; slot < plan.creatorCount; slot++) {
      const key = `sim-creator-v1:p${plan.productId}:c${slot}`;
      const creatorId = creatorByKey.get(key);
      if (creatorId !== undefined) {
        creatorLinks.push({ productId: plan.productId, creatorId, verificationStatus: 'NEEDS_REVIEW', isSimulated: true, simulationMetadata: sourceMeta(key, plan.scenario, { affiliateProfile: plan.affiliateProfile }) });
        creators.push({ creatorId, relationId: 0 });
        const relatedShop = shops[slot % Math.max(1, shops.length)];
        if (relatedShop) {
          creatorShopLinks.push({ creatorId, shopId: relatedShop.shopId, verificationStatus: 'NEEDS_REVIEW', isSimulated: true, simulationMetadata: sourceMeta(key, plan.scenario, { productId: plan.productId, affiliateProfile: plan.affiliateProfile }) });
          creatorShops.push({ creatorId, shopId: relatedShop.shopId });
        }
      }
    }
    shopsByProduct.set(plan.productId, shops);
    creatorsByProduct.set(plan.productId, creators);
    creatorShopsByProduct.set(plan.productId, creatorShops);
  }

  for (let i = 0; i < shopLinks.length; i += 2000) await db.productShop.createMany({ data: shopLinks.slice(i, i + 2000), skipDuplicates: true });
  for (let i = 0; i < creatorLinks.length; i += 2000) await db.productCreator.createMany({ data: creatorLinks.slice(i, i + 2000), skipDuplicates: true });
  for (let i = 0; i < creatorShopLinks.length; i += 2000) await db.creatorShop.createMany({ data: creatorShopLinks.slice(i, i + 2000), skipDuplicates: true });

  // Fetch all simulated relation IDs in two queries (rather than per product).
  const productIds = plans.map((p) => p.productId);
  const [shopRelations, creatorRelations] = await Promise.all([
    db.productShop.findMany({ where: { productId: { in: productIds }, isSimulated: true }, select: { id: true, productId: true, shopId: true } }),
    db.productCreator.findMany({ where: { productId: { in: productIds }, isSimulated: true }, select: { id: true, productId: true, creatorId: true } }),
  ]);
  const shopRelationByPair = new Map(shopRelations.map((r) => [`${r.productId}:${r.shopId}`, r.id]));
  const creatorRelationByPair = new Map(creatorRelations.map((r) => [`${r.productId}:${r.creatorId}`, r.id]));
  for (const [productId, shops] of shopsByProduct) for (const item of shops) item.relationId = shopRelationByPair.get(`${productId}:${item.shopId}`) ?? 0;
  for (const [productId, creators] of creatorsByProduct) for (const item of creators) item.relationId = creatorRelationByPair.get(`${productId}:${item.creatorId}`) ?? 0;

  return { shopsCreatedOrFound: shopRows.length, creatorsCreatedOrFound: creatorRows.length, productShopLinks: shopLinks.length, productCreatorLinks: creatorLinks.length, creatorShopLinks: creatorShopLinks.length, shopsByProduct, creatorsByProduct, creatorShopsByProduct };
}

export function shareWeights(productId: number, shopIds: number[], dayIndex: number, structure: SyntheticEntityPlan['marketStructure']): number[] {
  if (!shopIds.length) return [];
  if (shopIds.length === 1) return [1];
  const t = Math.min(1, dayIndex / 89);
  const concentration = structure === 'HIGHLY_CONCENTRATED' ? 0.76
    : structure === 'MODERATE' ? 0.50
      : structure === 'FRAGMENTED' ? 0.30
        : 0.70 - 0.32 * t;
  const leader = Math.max(0.2, Math.min(0.86, concentration + ((hashNumber(`${productId}:${dayIndex}`) % 800) / 10000 - 0.04)));
  const restWeights = shopIds.slice(1).map((id) => 0.75 + (hashNumber(`${productId}:${id}:${dayIndex}`) % 1000) / 1000);
  const restTotal = restWeights.reduce((a, b) => a + b, 0) || 1;
  const result = [leader, ...restWeights.map((w) => (1 - leader) * w / restTotal)];
  // Correct rounding drift on the last entry.
  result[result.length - 1] = (result.at(-1) ?? 0) + 1 - result.reduce((a, b) => a + b, 0);
  return result;
}

export function affiliateShare(plan: SyntheticEntityPlan, dayIndex: number, days: number): number {
  const t = Math.min(1, dayIndex / Math.max(1, days - 1));
  const noise = (hashNumber(`aff:${plan.productId}:${dayIndex}`) % 1000) / 1000;
  const base = plan.affiliateProfile === 'STRONG_AFFILIATE' ? 0.28 + 0.1 * t : 0.03 + 0.04 * t;
  return Math.max(0, Math.min(0.49, base + (noise - 0.5) * (plan.affiliateProfile === 'STRONG_AFFILIATE' ? 0.08 : 0.03)));
}

export function sourceMetadata(plan: SyntheticEntityPlan, key: string, extra: Record<string, unknown> = {}) {
  return sourceMeta(key, plan.scenario, { productId: plan.productId, marketStructure: plan.marketStructure, affiliateProfile: plan.affiliateProfile, ...extra });
}
