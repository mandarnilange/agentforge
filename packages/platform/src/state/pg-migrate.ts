/**
 * Postgres adapter for the shared migration runner.
 * Lives in platform (not core) so core stays pg-free.
 */

import type { MigrationExecutor } from "agentforge-core/state/migrate.js";
import type pg from "pg";

const PG_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

export function createPostgresExecutor(pool: pg.Pool): MigrationExecutor {
	return {
		dialect: "postgres",
		async initMigrationsTable() {
			await pool.query(PG_MIGRATIONS_TABLE_SQL);
		},
		async appliedVersions() {
			const { rows } = await pool.query(
				"SELECT version FROM schema_migrations",
			);
			return new Set(rows.map((r) => r.version as string));
		},
		async executeSql(sql) {
			await pool.query(sql);
		},
		async recordVersion(version) {
			await pool.query(
				"INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
				[version, new Date().toISOString()],
			);
		},
	};
}
