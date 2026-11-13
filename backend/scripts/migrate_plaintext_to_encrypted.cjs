/**
 * VYR-037 operator CLI: migrate existing plaintext raw Oracle records to encrypted storage.
 *
 *   node scripts/migrate_plaintext_to_encrypted.cjs --host <tenant-host> [--dry-run]
 *        [--table <raw_table>] [--batch-size 100] [--max-batches N] [--no-resume]
 *   node scripts/migrate_plaintext_to_encrypted.cjs --host <tenant-host> --table <raw_table>
 *        --rollback --confirm DECRYPT_TO_PLAINTEXT
 *
 * Requires a built backend (npm run build). Prints counts and failures only, never payloads.
 * Runbook: docs/architecture/plaintext_to_encrypted_migration.md
 */

const path = require('path');
const pg = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseArgs(argv) {
  const args = { resume: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--host') args.host = next();
    else if (a === '--table') args.table = next();
    else if (a === '--batch-size') args.batchSize = parseInt(next(), 10);
    else if (a === '--max-batches') args.maxBatches = parseInt(next(), 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--no-resume') args.resume = false;
    else if (a === '--rollback') args.rollback = true;
    else if (a === '--confirm') args.confirm = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.host) throw new Error('--host is required');
  if (args.rollback && !args.table) throw new Error('--rollback requires --table');
  return args;
}

function summarize(t) {
  if (t.tableSkippedReason) return `${t.tableName}: skipped (${t.tableSkippedReason})`;
  return `${t.tableName}: before ${t.before.total} total / ${t.before.plaintext} plaintext -> after ${t.after.total} / ${t.after.plaintext}; `
    + `candidates ${t.candidates}, migrated ${t.migrated}, skipped ${t.skipped}, failed ${t.failed}, empty ${t.emptyPayloads}, `
    + `complete ${t.complete}, reconciled ${t.reconciliation.reconciled}${t.resumedFromCheckpoint ? ', resumed' : ''}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mig = require('../dist/security/plaintextMigrationService.js');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let exitCode = 0;
  try {
    if (args.rollback) {
      const r = await mig.rollbackTable(pool, args.table, { environmentHost: args.host, confirm: args.confirm, batchSize: args.batchSize });
      console.log(`${r.tableName}: restored ${r.restored}, skipped ${r.skipped}, failed ${r.failed}`);
      r.failures.forEach(f => console.log(`  failed ${f.recordKey}: ${f.code} ${f.error}`));
      exitCode = r.failed > 0 ? 2 : 0;
    } else {
      const opts = { environmentHost: args.host, dryRun: args.dryRun, batchSize: args.batchSize, maxBatches: args.maxBatches, resume: args.resume };
      const tables = args.table ? [await mig.migrateTable(pool, args.table, opts)] : (await mig.migrateAll(pool, opts)).tables;
      console.log(args.dryRun ? 'DRY RUN (no changes made)' : 'MIGRATION');
      for (const t of tables) {
        console.log(summarize(t));
        t.failures.forEach(f => console.log(`  failed ${f.recordKey}: ${f.code} ${f.error}`));
      }
      const bad = tables.some(t => t.failed > 0 || !t.reconciliation.reconciled);
      exitCode = bad ? 2 : 0;
    }
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
