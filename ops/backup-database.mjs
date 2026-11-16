import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const u = new URL(process.env.DATABASE_URL);
const original = decodeURIComponent(u.pathname.slice(1));
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17);
const restoreName = `tiktok_restore_check_${stamp}`;
const directory = resolve('backups', `legacy-${stamp}`);
const bin = process.env.PG_BIN ?? 'D:/pgsql/bin';
const quote = s => String.fromCharCode(34) + s.replaceAll(String.fromCharCode(34), String.fromCharCode(34).repeat(2)) + String.fromCharCode(34);
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: original };
function command(exe, args, extra = {}) {
 const r = spawnSync(exe, args, { env, encoding: 'utf8', ...extra });
 if (r.error || r.status !== 0) throw new Error(`${exe}: ${r.error?.message ?? r.stderr}`);
 return r.stdout;
}
async function hashFile(file) {
 const hash = createHash('sha256');
 for await (const chunk of createReadStream(file)) hash.update(chunk);
 return hash.digest('hex');
}
async function inventory(c) {
 await c.query('SET TIME ZONE '+String.fromCharCode(39)+'UTC'+String.fromCharCode(39));
 const tables = (await c.query(`SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`)).rows;
 const result = {};
 for (const t of tables) {
  const rows = (await c.query(`SELECT to_jsonb(t)::text AS value FROM ${quote(t.schemaname)}.${quote(t.tablename)} t ORDER BY to_jsonb(t)::text COLLATE ${quote('C')}`)).rows;
  const hash = createHash('sha256');
  for (const row of rows) hash.update(row.value).update(String.fromCharCode(10));
  result[`${t.schemaname}.${t.tablename}`] = { rows: rows.length, sha256: hash.digest('hex') };
 }
 return { tables: result, constraints: (await c.query(`SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition,k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`)).rows, indexes: (await c.query(`SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,3`)).rows, sequences: (await c.query(`SELECT schemaname,sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2`)).rows, columns: (await c.query(`SELECT table_schema,table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2,4`)).rows };
}
const source = new pg.Client({ connectionString: process.env.DATABASE_URL });
let restored;
try {
 await stat(resolve('backups')); await mkdir(directory);
 const account = command('whoami.exe', []).trim();
 command('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
 await source.connect();
 const info = (await source.query(`SELECT version(),current_database(),current_user,pg_encoding_to_char(encoding) AS encoding,datcollate,datctype FROM pg_database WHERE datname=current_database()`)).rows[0];
 await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const snapshot = (await source.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
 const before = await inventory(source);
 command(join(bin, 'pg_dump.exe'), ['--format=custom', '--snapshot', snapshot, '--file', join(directory, 'database.dump')]);
 command(join(bin, 'pg_dumpall.exe'), ['--globals-only', '--file', join(directory, 'globals.sql')]);
 await source.query('ROLLBACK');
 const adminUrl = new URL(u); adminUrl.pathname = '/postgres';
 const admin = new pg.Client({ connectionString: adminUrl.toString() });
 await admin.connect();
 try { await admin.query(`CREATE DATABASE ${quote(restoreName)} TEMPLATE template0`); } finally { await admin.end(); }
 command(join(bin, 'pg_restore.exe'), ['--exit-on-error', '--dbname', restoreName, join(directory, 'database.dump')]);
 const restoredUrl = new URL(u); restoredUrl.pathname = '/' + restoreName;
 restored = new pg.Client({ connectionString: restoredUrl.toString() }); await restored.connect();
 const after = await inventory(restored);
 // pg_dump omits dropped-column slots; physical ordinals can compact on restore.
 const logical = inventory => ({ ...inventory, columns: inventory.columns.map(({ ordinal_position, ...column }) => column) });
 const matches = JSON.stringify(logical(before)) === JSON.stringify(logical(after));
 await writeFile(join(directory, 'source-inventory.json'), JSON.stringify(before, null, 2));
 await writeFile(join(directory, 'restored-inventory.json'), JSON.stringify(after, null, 2));
 command('tar.exe', ['-czf', join(directory, 'application.tar.gz'), 'src', 'dist', 'public', 'prisma', 'node_modules', 'tests', 'data', 'datasets', 'package.json', 'package-lock.json', 'tsconfig.json', 'prisma7.config.ts', '.env', '.env.example', '.gitignore'], { timeout: 600000 });
 const manifest = { version: 1, createdAt: new Date().toISOString(), originalDatabase: original, restoreDatabase: restoreName, postgres: info, applicationArchiveIncludesSecrets: true, protectedByWindowsAcl: true, comparison: matches ? 'PASS' : 'FAIL', countsAndLogicalChecksums: before.tables, files: {} };
 for (const f of ['database.dump','globals.sql','application.tar.gz','source-inventory.json','restored-inventory.json']) manifest.files[f] = { sha256: await hashFile(join(directory, f)), bytes: (await stat(join(directory, f))).size };
 await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
 if (!matches) throw new Error('Restore comparison failed. No cutover permitted.');
 console.log(JSON.stringify({ backupDirectory: directory, restoredDatabase: restoreName, comparison: 'PASS', tables: Object.keys(before.tables).length, totalRows: Object.values(before.tables).reduce((n,t)=>n+t.rows,0) }));
} finally { await restored?.end(); await source.end(); }
