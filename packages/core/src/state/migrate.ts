/**
 * Schema migration runner.
 *
 * Minimal replacement for `CREATE TABLE IF NOT EXISTS` — tracks applied
 * versions in a `schema_migrations` table and runs any missing `.sql`
 * files in lexical order at startup.
 *
 * Dialect-agnostic: callers provide a MigrationExecutor adapter. Core
 * ships a better-sqlite3 adapter here; platform ships a pg adapter
 * alongside `pg-store.ts`.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";

export type MigrationVersion = string;

export interface MigrationFile {
	readonly version: MigrationVersion;
	readonly name: string;
	readonly sql: string;
}

export interface MigrationResult {
	readonly version: MigrationVersion;
	readonly applied: boolean;
}

export interface MigrationExecutor {
	readonly dialect: "sqlite" | "postgres";
	initMigrationsTable(): Promise<void>;
	appliedVersions(): Promise<Set<MigrationVersion>>;
	executeSql(sql: string): Promise<void>;
	recordVersion(version: MigrationVersion): Promise<void>;
}

/**
 * Run any pending migrations. Safe to call on every process start —
 * already-applied migrations are skipped.
 */
export async function runMigrations(
	migrations: readonly MigrationFile[],
	executor: MigrationExecutor,
): Promise<MigrationResult[]> {
	const seen = new Set<string>();
	for (const m of migrations) {
		if (seen.has(m.version)) {
			throw new Error(
				`Duplicate migration version "${m.version}" — each file must have a unique prefix`,
			);
		}
		seen.add(m.version);
	}

	const ordered = [...migrations].sort((a, b) =>
		a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
	);

	await executor.initMigrationsTable();
	const applied = await executor.appliedVersions();

	const results: MigrationResult[] = [];
	for (const m of ordered) {
		if (applied.has(m.version)) {
			results.push({ version: m.version, applied: false });
			continue;
		}
		await executor.executeSql(m.sql);
		await executor.recordVersion(m.version);
		results.push({ version: m.version, applied: true });
	}
	return results;
}

/**
 * Read `*.sql` files from a directory. Returns an empty list if the
 * directory does not exist.
 */
export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}
	const sqlFiles = entries.filter((f) => f.endsWith(".sql")).sort();
	const files: MigrationFile[] = [];
	for (const name of sqlFiles) {
		const sql = await readFile(join(dir, name), "utf-8");
		const version = name.slice(0, -".sql".length);
		files.push({ version, name, sql });
	}
	return files;
}

// --- better-sqlite3 executor -----------------------------------------------

const SQLITE_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

/**
 * Build an async MigrationExecutor backed by a better-sqlite3 Database.
 * better-sqlite3 itself is synchronous; the "async" methods here resolve
 * immediately and are async only to satisfy the uniform interface.
 */
export function createSqliteExecutor(db: Database.Database): MigrationExecutor {
	const runSql = (sql: string) => {
		db.exec(sql);
	};
	return {
		dialect: "sqlite",
		async initMigrationsTable() {
			runSql(SQLITE_MIGRATIONS_TABLE_SQL);
		},
		async appliedVersions() {
			const rows = db
				.prepare("SELECT version FROM schema_migrations")
				.all() as Array<{ version: string }>;
			return new Set(rows.map((r) => r.version));
		},
		async executeSql(sql) {
			runSql(sql);
		},
		async recordVersion(version) {
			db.prepare(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
			).run(version, new Date().toISOString());
		},
	};
}
