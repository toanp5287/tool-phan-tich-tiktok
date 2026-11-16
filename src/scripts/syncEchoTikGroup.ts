import { runEchoTikGroupSync, ECHOTIK_GROUP_ENDPOINTS } from '../services/echotik/echoTikGroupSync.js';
import type { EchoTikGroup } from '../services/echotik/echoTikSyncContext.js';
import { disconnectDatabase } from '../config/db.js';

try {
  const [group, ...extra] = process.argv.slice(2);
  if (!group || !Object.hasOwn(ECHOTIK_GROUP_ENDPOINTS, group) || extra.length > 0) {
    throw new Error('Usage: node dist/scripts/syncEchoTikGroup.js shops|products|trends|categories');
  }
  const report = await runEchoTikGroupSync(group as EchoTikGroup);
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'BLOCKED' || report.status === 'FAILED') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
