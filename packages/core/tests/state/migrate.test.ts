/**
 * Tests for the shared migration runner.
 *
 * The runner is used by both dialects (better-sqlite3 sync + pg async) via a
 * MigrationExecutor adapter. Tests drive the runner with a fake in-memory
 * executor so we can assert behaviour independent of any DB driver.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadMigrations,
	type MigrationExecutor,
	type MigrationFile,
	runMigrations,
} from "../../src/state/migrate.js";

class FakeExecutor implements MigrationExecutor {
	readonly dialect = "sqlite" as const;
	initialised = false;
	applied = new Set<string>();
	executed: string[] = [];
	recorded: string[] = [];
	failOnSql: string | null = null;

	async initMigrationsTable(): Promise<void> {
		this.initialised = true;
	}
	async appliedVersions(): Promise<Set<string>> {
		return new Set(this.applied);
	}
	async executeSql(sql: string): Promise<void> {
		if (this.failOnSql && sql.includes(this.failOnSql)) {
			throw new Error(`simulated failure on ${this.failOnSql}`);
		}
		this.executed.push(sql);
	}
	async recordVersion(version: string): Promise<void> {
		this.recorded.push(version);
		this.applied.add(version);
	}
}

function makeFile(version: string, sql: string): MigrationFile {
	return { version, name: `${version}.sql`, sql };
}

describe("runMigrations", () => {
	it("initialises the migrations table and applies all pending files in order", async () => {
		const exec = new FakeExecutor();
		const files = [
			makeFile("001-state", "CREATE TABLE runs (id TEXT);"),
			makeFile("002-gates", "CREATE TABLE gates (id TEXT);"),
			makeFile("003-nodes", "CREATE TABLE nodes (id TEXT);"),
		];

		const results = await runMigrations(files, exec);

		expect(exec.initialised).toBe(true);
		expect(exec.executed).toEqual(files.map((f) => f.sql));
		expect(exec.recorded).toEqual(["001-state", "002-gates", "003-nodes"]);
		expect(results.map((r) => r.applied)).toEqual([true, true, true]);
	});

	it("skips migrations already recorded as applied", async () => {
		const exec = new FakeExecutor();
		exec.applied.add("001-state");
		const files = [
			makeFile("001-state", "CREATE TABLE runs (id TEXT);"),
			makeFile("002-gates", "CREATE TABLE gates (id TEXT);"),
		];

		const results = await runMigrations(files, exec);

		expect(exec.executed).toEqual([files[1].sql]);
		expect(exec.recorded).toEqual(["002-gates"]);
		expect(results[0].applied).toBe(false);
		expect(results[1].applied).toBe(true);
	});

	it("runs zero migrations when the directory is empty", async () => {
		const exec = new FakeExecutor();
		const results = await runMigrations([], exec);
		expect(exec.initialised).toBe(true);
		expect(exec.executed).toHaveLength(0);
		expect(results).toHaveLength(0);
	});

	it("processes files in lexical order regardless of input order", async () => {
		const exec = new FakeExecutor();
		// Input deliberately out of order
		const files = [
			makeFile("003-later", "CREATE TABLE c (id TEXT);"),
			makeFile("001-first", "CREATE TABLE a (id TEXT);"),
			makeFile("002-middle", "CREATE TABLE b (id TEXT);"),
		];

		await runMigrations(files, exec);

		expect(exec.recorded).toEqual(["001-first", "002-middle", "003-later"]);
	});

	it("does not record a migration whose SQL failed", async () => {
		const exec = new FakeExecutor();
		exec.failOnSql = "EXPLODE";
		const files = [
			makeFile("001-ok", "CREATE TABLE runs (id TEXT);"),
			makeFile("002-boom", "EXPLODE;"),
			makeFile("003-unreached", "CREATE TABLE nodes (id TEXT);"),
		];

		await expect(runMigrations(files, exec)).rejects.toThrow(/simulated/);

		// Only the first SQL ran successfully; second threw; third was never attempted
		expect(exec.executed).toEqual([files[0].sql]);
		expect(exec.recorded).toEqual(["001-ok"]);
	});

	it("detects duplicate versions and errors before running anything", async () => {
		const exec = new FakeExecutor();
		const files = [
			makeFile("001-state", "CREATE TABLE a;"),
			makeFile("001-state", "CREATE TABLE b;"),
		];

		await expect(runMigrations(files, exec)).rejects.toThrow(/duplicate/i);
		expect(exec.executed).toHaveLength(0);
	});
});

describe("loadMigrations", () => {
	const dir = "/tmp/agentforge-migrate-load-test";

	beforeEach(() => {
		rmSync(dir, { recursive: true, force: true });
		mkdirSync(dir, { recursive: true });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reads .sql files and strips the .sql extension from version", async () => {
		writeFileSync(join(dir, "001-initial.sql"), "CREATE TABLE a (id TEXT);");
		writeFileSync(join(dir, "002-next.sql"), "CREATE TABLE b (id TEXT);");
		// Non-.sql files are ignored
		writeFileSync(join(dir, "README.md"), "ignore me");

		const files = await loadMigrations(dir);
		expect(files.map((f) => f.version)).toEqual(["001-initial", "002-next"]);
		expect(files[0].sql).toContain("CREATE TABLE a");
		expect(files[1].sql).toContain("CREATE TABLE b");
	});

	it("returns an empty list when the directory does not exist", async () => {
		const files = await loadMigrations("/tmp/nonexistent-xyz-abc-123");
		expect(files).toEqual([]);
	});
});
