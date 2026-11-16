import { collectDemo } from '../services/echotik/echoTikDemoCollectionService.js';
import { disconnectDatabase } from '../config/db.js';

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
try {
  if (!args.includes('--execute-approved')) throw new Error('No collection started. Requires separate approval and --execute-approved --batch <name> --phase discover|collect --max-requests <1..10> --keep-reserve <n> [--product <externalId>]');
  const batch = args.includes('--batch') ? value('--batch') : '';
  const phase = args.includes('--phase') ? value('--phase') : '';
  const result = await collectDemo({ batch: batch ?? '', phase: phase as 'discover' | 'collect', productId: args.includes('--product') ? value('--product') : undefined, maxRequests: args.includes('--max-requests') ? Number(value('--max-requests')) : 0, keepReserve: args.includes('--keep-reserve') ? Number(value('--keep-reserve')) : 5 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Demo collection failed');
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
