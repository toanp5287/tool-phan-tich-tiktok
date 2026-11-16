-- Additive: grant the application role the minimum DML + sequence access it needs
-- to write synthetic Shop/Creator/relation data. No superuser, no owner change,
-- no role assumption (guards via `IF NOT EXISTS`-style DO blocks are unnecessary
-- because GRANT is idempotent). All statements are safe to re-run.

-- Synthetic write path tables (Shop, Creator, and the join tables).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "Shop", "Creator", "ProductShop", "ProductCreator", "CreatorShop"
  TO tiktok_dataset_app;

-- Sequences backing the autoincrement primary keys of the write-path tables.
GRANT USAGE, SELECT ON SEQUENCE
  "Shop_id_seq", "Creator_id_seq", "ProductShop_id_seq", "ProductCreator_id_seq", "CreatorShop_id_seq"
  TO tiktok_dataset_app;

-- MetricSnapshot already has DML from the earlier metric-snapshot migration;
-- reaffirm it so deployments bootstrap a consistent grant set.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MetricSnapshot" TO tiktok_dataset_app;
GRANT USAGE, SELECT ON SEQUENCE "MetricSnapshot_id_seq" TO tiktok_dataset_app;
