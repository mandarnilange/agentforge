/**
 * Postgres adapter for the shared migration runner.
 * Lives in platform (not core) so core stays pg-free.
 *
 * `applyPgMigrations()` is the entry point used by both PostgresStateStore
 * and PgDefinitionStore at startup. It serialises concurrent migrations
 * across multiple processes by:
 *
 *   1. Taking a dedicated client out of the pool (so the advisory lock
 *      and the migration queries live in the same backend session).
 *   2. Acquiring a session-level advisory lock — a second process trying
 *      the same key blocks until the first releases.
 *   3. Running the migration loop on that client.
 *   4. Using `ON CONFLICT (version) DO NOTHING` on schema_migrations so
 *      even if the advisory lock somehow fails, two processes can't
 *      double-write the same version.
 */

import {
	loadMigrations,
	type MigrationExecutor,
	type MigrationFile,
	type MigrationResult,
	runMigrations,
} from "@mandarnilange/agentforge-core/state/migrate.js";
import type pg from "pg";

const PG_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

/**
 * Arbitrary but stable lock key for the migration session. Kept inside
 * Number.MAX_SAFE_INTEGER so JS conversion is clean. Same value across
 * stores so that the state-store and definition-store migrations don't
 * race each other in the same database.
 */
export const PG_MIGRATION_LOCK_KEY = 8675309001;

/** Anything with a pg-style `query()` method — Pool or PoolClient. */
type PgQueryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

export function createPostgresExecutor(q: PgQueryable): MigrationExecutor {
	return {
		dialect: "postgres",
		async initMigrationsTable() {
			await q.query(PG_MIGRATIONS_TABLE_SQL);
		},
		async appliedVersions() {
			const { rows } = await q.query("SELECT version FROM schema_migrations");
			return new Set(rows.map((r) => r.version as string));
		},
		async executeSql(sql) {
			await q.query(sql);
		},
		async recordVersion(version) {
			await q.query(
				`INSERT INTO schema_migrations (version, applied_at)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
				[version, new Date().toISOString()],
			);
		},
	};
}

/**
 * Run all pending migrations from `migrationsDir` against `pool`, holding
 * a session-level advisory lock for the duration. Safe to call from
 * multiple concurrent processes — losers block until the winner releases.
 */
export async function applyPgMigrations(
	pool: pg.Pool,
	migrationsDir: string,
): Promise<MigrationResult[]> {
	const migrations: MigrationFile[] = await loadMigrations(migrationsDir);
	const client = await pool.connect();
	try {
		await client.query("SELECT pg_advisory_lock($1)", [PG_MIGRATION_LOCK_KEY]);
		const executor = createPostgresExecutor(client);
		return await runMigrations(migrations, executor);
	} finally {
		try {
			await client.query("SELECT pg_advisory_unlock($1)", [
				PG_MIGRATION_LOCK_KEY,
			]);
		} catch {
			// Best effort — connection may already be dead.
		}
		client.release();
	}
}
