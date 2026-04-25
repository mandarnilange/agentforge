/**
 * Tests for the pre-v0.2.0 SQLite bridge.
 *
 * Pre-baseline DBs lack columns that the v0.2.0 baseline expects. The
 * migration runner's CREATE TABLE IF NOT EXISTS no-ops on these existing
 * tables, so without a bridge those columns stay missing while
 * schema_migrations still gets 001-state recorded — the worst of both
 * worlds.
 */

import { existsSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-legacy-bridge-test.db";

const LEGACY_DDL = `
CREATE TABLE pipeline_runs (
	id TEXT PRIMARY KEY,
	project_name TEXT NOT NULL,
	pipeline_name TEXT NOT NULL,
	status TEXT NOT NULL,
	current_phase INTEGER NOT NULL DEFAULT 1,
	started_at TEXT NOT NULL,
	completed_at TEXT,
	created_at TEXT NOT NULL
);
CREATE TABLE agent_runs (
	id TEXT PRIMARY KEY,
	pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
	agent_name TEXT NOT NULL,
	phase INTEGER NOT NULL,
	node_name TEXT NOT NULL,
	status TEXT NOT NULL,
	input_artifact_ids TEXT NOT NULL DEFAULT '[]',
	output_artifact_ids TEXT NOT NULL DEFAULT '[]',
	token_usage TEXT,
	duration_ms INTEGER,
	error TEXT,
	started_at TEXT NOT NULL,
	completed_at TEXT,
	created_at TEXT NOT NULL
);
CREATE TABLE gates (
	id TEXT PRIMARY KEY,
	pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
	phase_completed INTEGER NOT NULL,
	phase_next INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	reviewer TEXT,
	comment TEXT,
	revision_notes TEXT,
	artifact_version_ids TEXT NOT NULL DEFAULT '[]',
	cross_cutting_findings TEXT,
	decided_at TEXT,
	created_at TEXT NOT NULL
);
CREATE TABLE nodes (
	name TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	capabilities TEXT NOT NULL DEFAULT '[]',
	max_concurrent_runs INTEGER,
	status TEXT NOT NULL,
	active_runs INTEGER NOT NULL DEFAULT 0,
	last_heartbeat TEXT,
	updated_at TEXT NOT NULL
);
INSERT INTO pipeline_runs (id, project_name, pipeline_name, status, current_phase, started_at, created_at)
VALUES ('legacy-pipe-1', 'old-project', 'std', 'running', 1, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
`;

function seedLegacyDb(): void {
	if (existsSync(TEST_DB)) rmSync(TEST_DB);
	const db = new Database(TEST_DB);
	db.pragma("journal_mode = WAL");
	const runSql: (sql: string) => void = db.exec.bind(db);
	runSql(LEGACY_DDL);
	db.close();
}

function columnNames(dbPath: string, table: string): string[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return (
			db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
				name: string;
			}>
		).map((c) => c.name);
	} finally {
		db.close();
	}
}

describe("Legacy SQLite DB bridge (pre-v0.2.0)", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("brings post-baseline columns onto a legacy DB during construction", () => {
		seedLegacyDb();
		// Sanity — the legacy seed really lacks the post-baseline columns.
		const before = new Set(columnNames(TEST_DB, "agent_runs"));
		expect(before.has("exit_reason")).toBe(false);
		expect(before.has("last_status_at")).toBe(false);
		expect(before.has("status_message")).toBe(false);
		expect(before.has("retry_count")).toBe(false);
		expect(new Set(columnNames(TEST_DB, "pipeline_runs")).has("inputs")).toBe(
			false,
		);
		expect(new Set(columnNames(TEST_DB, "gates")).has("version")).toBe(false);

		// Open through the store — bridge should run before migrations.
		const store = new SqliteStateStore(TEST_DB);
		store.close();

		const agentCols = new Set(columnNames(TEST_DB, "agent_runs"));
		const pipelineCols = new Set(columnNames(TEST_DB, "pipeline_runs"));
		const gateCols = new Set(columnNames(TEST_DB, "gates"));

		for (const col of [
			"exit_reason",
			"last_status_at",
			"status_message",
			"retry_count",
			"recovery_token",
			"revision_notes",
			"provider",
			"model_name",
			"cost_usd",
		]) {
			expect(agentCols.has(col), `agent_runs missing ${col}`).toBe(true);
		}
		for (const col of ["inputs", "version", "session_name"]) {
			expect(pipelineCols.has(col), `pipeline_runs missing ${col}`).toBe(true);
		}
		expect(gateCols.has("version")).toBe(true);

		// Existing data preserved.
		const db = new Database(TEST_DB, { readonly: true });
		const row = db
			.prepare("SELECT id, project_name FROM pipeline_runs WHERE id = ?")
			.get("legacy-pipe-1") as { id: string; project_name: string };
		db.close();
		expect(row.id).toBe("legacy-pipe-1");
		expect(row.project_name).toBe("old-project");
	});

	it("re-opening a bridged DB is idempotent — no duplicate column errors", () => {
		seedLegacyDb();
		new SqliteStateStore(TEST_DB).close();
		expect(() => new SqliteStateStore(TEST_DB).close()).not.toThrow();
	});

	it("a fresh DB still gets the baseline schema (no bridge interference)", () => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		new SqliteStateStore(TEST_DB).close();
		const cols = new Set(columnNames(TEST_DB, "agent_runs"));
		expect(cols.has("exit_reason")).toBe(true);
		expect(cols.has("status_message")).toBe(true);
	});
});
