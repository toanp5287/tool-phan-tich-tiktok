import 'dotenv/config';
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../generated/v2');

/**
 * Derives CreatorShop only from two verified, evidenced canonical relations.
 * This command never matches names, captions, category labels, or media URLs.
 */
export async function recoverDerivedCreatorShops(db) {
  const productCreatorLinks = await db.productCreator.findMany({
    where: { verificationStatus: 'VERIFIED' },
    include: {
      evidence: { where: { verificationStatus: 'VERIFIED' }, orderBy: { id: 'asc' }, take: 1 },
      product: {
        include: {
          shops: {
            where: { verificationStatus: 'VERIFIED', isActive: true },
            include: { evidence: { where: { verificationStatus: 'VERIFIED' }, orderBy: { id: 'asc' }, take: 1 } },
          },
        },
      },
    },
  });

  let created = 0;
  let existing = 0;
  let skippedWithoutEvidence = 0;

  for (const productCreator of productCreatorLinks) {
    const creatorEvidence = productCreator.evidence[0];
    if (!creatorEvidence) {
      skippedWithoutEvidence += productCreator.product.shops.length;
      continue;
    }

    for (const productShop of productCreator.product.shops) {
      const shopEvidence = productShop.evidence[0];
      if (!shopEvidence) {
        skippedWithoutEvidence++;
        continue;
      }

      const current = await db.creatorShop.findUnique({
        where: { creatorId_shopId: { creatorId: productCreator.creatorId, shopId: productShop.shopId } },
        select: { id: true },
      });
      if (current) {
        existing++;
        continue;
      }

      await db.$transaction(async (tx) => {
        const link = await tx.creatorShop.create({
          data: {
            creatorId: productCreator.creatorId,
            shopId: productShop.shopId,
            verificationStatus: 'VERIFIED',
          },
        });
        await tx.relationEvidence.create({
          data: {
            rawRecordId: creatorEvidence.rawRecordId,
            creatorShopId: link.id,
            verificationStatus: 'VERIFIED',
            method: 'DERIVED_VERIFIED_PRODUCT_CREATOR_AND_PRODUCT_SHOP_V1',
            evidencePath: `${creatorEvidence.evidencePath} + ${shopEvidence.evidencePath}`,
            explanation: `Derived only after verified ProductCreator ${productCreator.id} and ProductShop ${productShop.id}; both source evidence records remain traceable.`,
          },
        });
      });
      created++;
    }
  }

  return { scannedProductCreatorLinks: productCreatorLinks.length, created, existing, skippedWithoutEvidence };
}

export async function main() {
  if (!process.env.NEW_DATABASE_URL) throw new Error('NEW_DATABASE_URL required');
  const url = new URL(process.env.NEW_DATABASE_URL);
  if (url.pathname !== '/tiktok_datasets_v2') throw new Error('Refusing non-dataset database');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  try {
    console.log(JSON.stringify(await recoverDerivedCreatorShops(db)));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) await main();
