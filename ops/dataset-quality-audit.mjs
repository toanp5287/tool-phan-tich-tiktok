import 'dotenv/config';
import pg from 'pg';

const EXPECTED_DATABASE = 'tiktok_datasets_v2';
const EXPECTED_GENERATION = 'TikTok dataset database v2; no legacy data';

export const QUALITY_CHECKS = [
  {
    id: 'identity_and_relation_integrity',
    sql: `
      WITH entity_identity AS (
        SELECT 'Product' AS entity, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ExternalIdentity" i WHERE i."productId"=p.id))::bigint AS missing_identity FROM "Product" p
        UNION ALL SELECT 'Shop', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ExternalIdentity" i WHERE i."shopId"=s.id))::bigint FROM "Shop" s
        UNION ALL SELECT 'Creator', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ExternalIdentity" i WHERE i."creatorId"=c.id))::bigint FROM "Creator" c
        UNION ALL SELECT 'CreatorChannel', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ExternalIdentity" i WHERE i."channelId"=c.id))::bigint FROM "CreatorChannel" c
        UNION ALL SELECT 'Video', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "ExternalIdentity" i WHERE i."videoId"=v.id))::bigint FROM "Video" v
      ), relation_evidence AS (
        SELECT 'ProductShop' AS relation, count(*)::bigint AS links, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "RelationEvidence" e WHERE e."productShopId"=r.id))::bigint AS without_evidence FROM "ProductShop" r
        UNION ALL SELECT 'ProductCreator', count(*)::bigint, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "RelationEvidence" e WHERE e."productCreatorId"=r.id))::bigint FROM "ProductCreator" r
        UNION ALL SELECT 'CreatorShop', count(*)::bigint, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "RelationEvidence" e WHERE e."creatorShopId"=r.id))::bigint FROM "CreatorShop" r
        UNION ALL SELECT 'ProductVideo', count(*)::bigint, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "RelationEvidence" e WHERE e."productVideoId"=r.id))::bigint FROM "ProductVideo" r
      )
      SELECT json_build_object(
        'entitiesWithoutExternalIdentity', (SELECT json_object_agg(entity, missing_identity) FROM entity_identity),
        'duplicateExternalKeys', (SELECT count(*) FROM (SELECT 1 FROM "ExternalIdentity" GROUP BY namespace, "externalId" HAVING count(*) > 1) d),
        'identitiesWithInvalidTargetCount', (SELECT count(*) FROM "ExternalIdentity" WHERE num_nonnulls("productId","shopId","creatorId","channelId","videoId") <> 1),
        'relationsWithoutEvidence', (SELECT json_object_agg(relation, without_evidence) FROM relation_evidence),
        'categoryHierarchyMismatches', (SELECT count(*) FROM "ProductCategory" pc WHERE (pc."subCategoryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SubCategory" s WHERE s.id=pc."subCategoryId" AND s."categoryId"=pc."categoryId")) OR (pc."thirdLevelCategoryId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ThirdLevelCategory" t JOIN "SubCategory" s ON s.id=t."subCategoryId" WHERE t.id=pc."thirdLevelCategoryId" AND s.id=pc."subCategoryId" AND s."categoryId"=pc."categoryId"))),
        'blankRequiredNames', (SELECT count(*) FROM "Product" WHERE btrim(title)='' UNION ALL SELECT count(*) FROM "Shop" WHERE btrim(name)='' UNION ALL SELECT count(*) FROM "Creator" WHERE btrim("displayName")='')
      ) AS result
    `,
  },
  {
    id: 'relation_coverage',
    sql: `
      SELECT json_build_object(
        'productsWithoutShop', (SELECT count(*) FROM "Product" p WHERE NOT EXISTS (SELECT 1 FROM "ProductShop" r WHERE r."productId"=p.id)),
        'shopsWithoutProduct', (SELECT count(*) FROM "Shop" s WHERE NOT EXISTS (SELECT 1 FROM "ProductShop" r WHERE r."shopId"=s.id)),
        'creatorsWithoutProduct', (SELECT count(*) FROM "Creator" c WHERE NOT EXISTS (SELECT 1 FROM "ProductCreator" r WHERE r."creatorId"=c.id)),
        'videosWithoutChannel', (SELECT count(*) FROM "Video" WHERE "channelId" IS NULL),
        'relationCounts', json_build_object(
          'ProductShop',(SELECT count(*) FROM "ProductShop"),'ProductCreator',(SELECT count(*) FROM "ProductCreator"),
          'CreatorShop',(SELECT count(*) FROM "CreatorShop"),'ProductVideo',(SELECT count(*) FROM "ProductVideo")
        )
      ) AS result
    `,
  },
  {
    id: 'observation_time_coverage',
    sql: `
      SELECT entity, total, missing_observed_at, future_observed_at, stale_over_30d,
             min_observed_at, max_observed_at, min_imported_at, max_imported_at
      FROM (
        SELECT 'ProductObservation' AS entity, count(*) AS total, count(*) FILTER (WHERE "observedAt" IS NULL) AS missing_observed_at, count(*) FILTER (WHERE "observedAt" > now()) AS future_observed_at, count(*) FILTER (WHERE "observedAt" < now()-interval '30 days') AS stale_over_30d, min("observedAt") AS min_observed_at, max("observedAt") AS max_observed_at, min("importedAt") AS min_imported_at, max("importedAt") AS max_imported_at FROM "ProductObservation"
        UNION ALL SELECT 'ShopObservation', count(*), count(*) FILTER (WHERE "observedAt" IS NULL), count(*) FILTER (WHERE "observedAt" > now()), count(*) FILTER (WHERE "observedAt" < now()-interval '30 days'), min("observedAt"), max("observedAt"), min("importedAt"), max("importedAt") FROM "ShopObservation"
        UNION ALL SELECT 'CreatorChannelObservation', count(*), count(*) FILTER (WHERE "observedAt" IS NULL), count(*) FILTER (WHERE "observedAt" > now()), count(*) FILTER (WHERE "observedAt" < now()-interval '30 days'), min("observedAt"), max("observedAt"), min("importedAt"), max("importedAt") FROM "CreatorChannelObservation"
        UNION ALL SELECT 'VideoObservation', count(*), count(*) FILTER (WHERE "observedAt" IS NULL), count(*) FILTER (WHERE "observedAt" > now()), count(*) FILTER (WHERE "observedAt" < now()-interval '30 days'), min("observedAt"), max("observedAt"), min("importedAt"), max("importedAt") FROM "VideoObservation"
      ) observations ORDER BY entity
    `,
  },
  {
    id: 'source_and_raw_coverage',
    sql: `
      SELECT s.code AS source, s."usageRestriction", count(DISTINCT f.id) AS files,
             coalesce(sum(f."recordCount"),0) AS declared_records, count(r.id) AS stored_records,
             count(*) FILTER (WHERE r.id IS NOT NULL AND r.state='QUARANTINED') AS quarantined_records,
             count(*) FILTER (WHERE r.id IS NOT NULL AND r.state NOT IN ('ACCEPTED','QUARANTINED')) AS other_states
      FROM "DataSource" s LEFT JOIN "DatasetFile" f ON f."sourceId"=s.id
      LEFT JOIN "RawRecord" r ON r."datasetFileId"=f.id
      GROUP BY s.id, s.code, s."usageRestriction" ORDER BY s.code
    `,
  },
  {
    id: 'metric_snapshot_integrity',
    sql: `
      SELECT json_build_object(
        'total', count(*), 'missingObservedAt', count(*) FILTER (WHERE "observedAt" IS NULL),
        'futureObservedAt', count(*) FILTER (WHERE "observedAt" > now()),
        'negativeValues', count(*) FILTER (WHERE value < 0),
        'unsupportedEntityTypes', count(*) FILTER (WHERE "entityType" NOT IN ('PRODUCT','SHOP','CREATOR','VIDEO','CATEGORY')),
        'danglingEntityReferences', count(*) FILTER (WHERE
          ("entityType"='PRODUCT' AND NOT EXISTS (SELECT 1 FROM "Product" e WHERE e.id="MetricSnapshot"."entityId")) OR
          ("entityType"='SHOP' AND NOT EXISTS (SELECT 1 FROM "Shop" e WHERE e.id="MetricSnapshot"."entityId")) OR
          ("entityType"='CREATOR' AND NOT EXISTS (SELECT 1 FROM "CreatorChannel" e WHERE e.id="MetricSnapshot"."entityId")) OR
          ("entityType"='VIDEO' AND NOT EXISTS (SELECT 1 FROM "Video" e WHERE e.id="MetricSnapshot"."entityId")) OR
          ("entityType"='CATEGORY' AND NOT EXISTS (SELECT 1 FROM "Category" e WHERE e.id="MetricSnapshot"."entityId"))
        )
      ) AS result FROM "MetricSnapshot"
    `,
  },
].map((check) => ({ ...check, sql: check.sql.trim() }));

export function qualityState(count, severity = 'WARNING') {
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) return 'UNVERIFIED';
  if (value === 0) return 'VALID';
  return severity === 'INVALID' ? 'INVALID' : severity === 'UNVERIFIED' ? 'UNVERIFIED' : 'WARNING';
}

export async function runAudit(connectionString) {
  if (!connectionString) throw new Error('NEW_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (decodeURIComponent(url.pathname.slice(1)) !== EXPECTED_DATABASE) {
    throw new Error(`Refusing audit: expected database ${EXPECTED_DATABASE}`);
  }

  const client = new pg.Client({ connectionString: url.toString(), application_name: 'tiktok-dataset-quality-audit' });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    const guard = await client.query(`SELECT current_database() AS database, obj_description('public'::regnamespace) AS generation, current_setting('transaction_read_only') AS read_only`);
    const identity = guard.rows[0];
    if (identity?.database !== EXPECTED_DATABASE || identity?.generation !== EXPECTED_GENERATION || identity?.read_only !== 'on') {
      throw new Error('Refusing audit: database generation or read-only transaction guard failed');
    }

    const results = {};
    for (const check of QUALITY_CHECKS) {
      const { rows } = await client.query(check.sql);
      results[check.id] = check.id === 'observation_time_coverage' || check.id === 'source_and_raw_coverage'
        ? rows
        : rows[0]?.result ?? null;
    }
    await client.query('ROLLBACK');
    transactionOpen = false;
    return { generatedAt: new Date().toISOString(), database: identity.database, generation: identity.generation, transactionReadOnly: true, results };
  } finally {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  try {
    console.log(JSON.stringify(await runAudit(process.env.NEW_DATABASE_URL), null, 2));
  } catch (error) {
    console.error(`Dataset quality audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
