#!/usr/bin/env node
/**
 * Legacy entrypoint kept only as a fail-closed stub.
 *
 * EchoTik sync must run one account-scoped group at a time with a hard cap of
 * 15 HTTP requests. Use one of:
 *   npm run echotik:sync-shops
 *   npm run echotik:sync-products
 *   npm run echotik:sync-trends
 *   npm run echotik:sync-categories
 */

console.error(
  [
    'Full EchoTik sync is disabled.',
    '',
    'Run exactly one group command instead (each capped at 15 requests):',
    '  npm run echotik:sync-shops',
    '  npm run echotik:sync-products',
    '  npm run echotik:sync-trends',
    '  npm run echotik:sync-categories',
  ].join('\n'),
);
process.exit(1);
