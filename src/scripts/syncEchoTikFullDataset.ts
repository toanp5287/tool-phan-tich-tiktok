#!/usr/bin/env node
/**
 * Legacy full-dataset entrypoint kept only as a fail-closed stub.
 *
 * The orchestrator refuses to run outside a guarded group context, and full
 * sync exceeds the per-command 15-request budget. Use the group commands.
 */

console.error(
  [
    'Full EchoTik dataset sync is disabled.',
    '',
    'Run exactly one group command instead (each capped at 15 requests):',
    '  npm run echotik:sync-shops',
    '  npm run echotik:sync-products',
    '  npm run echotik:sync-trends',
    '  npm run echotik:sync-categories',
  ].join('\n'),
);
process.exit(1);
