/**
 * Automated migration runner.
 * - Reads *.sql files from db/migrations/ in lexicographic order.
 * - Tracks applied migrations in the schema_migrations table.
 * - Each migration runs inside a transaction; failure rolls back and stops.
 * - Safe to run multiple times (idempotent).
 *
 * Usage:
 *   node db/migrate.js                   # run pending migrations
 *   RUN_MIGRATIONS_ON_STARTUP=true       # auto-run at server boot (env flag)
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT        PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

export async function runMigrations(pool) {
  await pool.query(TRACKING_TABLE);

  const applied = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  const appliedSet = new Set(applied.rows.map((r) => r.filename));

  let files;
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    // migrations directory may not exist in some deployments
    return { applied: 0, skipped: 0, total: 0 };
  }

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    process.stderr.write(`[migrate] Up to date (${files.length} migration${files.length === 1 ? "" : "s"} applied)\n`);
    return { applied: 0, skipped: appliedSet.size, total: files.length };
  }

  process.stderr.write(`[migrate] ${pending.length} pending migration${pending.length === 1 ? "" : "s"}\n`);

  for (const filename of pending) {
    const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
    process.stderr.write(`[migrate] Applying ${filename} …\n`);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [filename]
      );
      await client.query("COMMIT");
      process.stderr.write(`[migrate] ✓ ${filename}\n`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migration "${filename}" failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  return { applied: pending.length, skipped: appliedSet.size, total: files.length };
}

// ── CLI entry point ────────────────────────────────────────────────────────────
// Run directly: node db/migrate.js
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { Pool } = await import("pg");

  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write("[migrate] DATABASE_URL is not set\n");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const result = await runMigrations(pool);
    process.stderr.write(
      `[migrate] Done — applied ${result.applied}, skipped ${result.skipped}, total ${result.total}\n`
    );
    process.exit(0);
  } catch (err) {
    process.stderr.write(`[migrate] Error: ${err.message}\n`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}
