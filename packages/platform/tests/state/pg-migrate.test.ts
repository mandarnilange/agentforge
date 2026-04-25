/**
 * applyPgMigrations() must:
 *   1. Take a dedicated client out of the pool (so pg_advisory_lock and
 *      the migration queries land on the same backend session).
 *   2. Acquire pg_advisory_lock before reading the applied set.
 *   3. Use ON CONFLICT (version) DO NOTHING on the schema_migrations
 *      INSERT so concurrent processes never double-write a row.
 *   4. Release the lock + the client even if the migration throws.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockEnd, mockRelease } = vi.hoisted(() => ({
	mockQuery: vi.fn(),
	mockEnd: vi.fn().mockResolvedValue(undefined),
	mockRelease: vi.fn(),
}));

vi.mock("pg", () => {
	class MockPool {
		query = mockQuery;
		end = mockEnd;
		async connect() {
			return { query: mockQuery, release: mockRelease };
		}
	}
	return { default: { Pool: MockPool } };
});

import pg from "pg";
import {
	applyPgMigrations,
	PG_MIGRATION_LOCK_KEY,
} from "../../src/state/pg-migrate.js";

const MIGRATIONS_DIR = "/tmp/pg-migrate-test-migrations";

function seedMigrations(files: Record<string, string>): void {
	rmSync(MIGRATIONS_DIR, { recursive: true, force: true });
	mkdirSync(MIGRATIONS_DIR, { recursive: true });
	for (const [name, sql] of Object.entries(files)) {
		writeFileSync(join(MIGRATIONS_DIR, name), sql);
	}
}

describe("applyPgMigrations", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		rmSync(MIGRATIONS_DIR, { recursive: true, force: true });
	});

	it("acquires pg_advisory_lock, runs migrations, and unlocks at end", async () => {
		seedMigrations({ "001-test.sql": "CREATE TABLE foo (id TEXT);" });
		// Default mock returns empty rows → no migrations applied yet
		mockQuery.mockResolvedValue({ rows: [] });
		// Lock acquire returns whatever; the runner only cares it didn't throw
		const pool = new pg.Pool({ connectionString: "postgres://x" });
		await applyPgMigrations(pool, MIGRATIONS_DIR);

		const calls = mockQuery.mock.calls;
		const lockCall = calls.find(
			(c) => typeof c[0] === "string" && c[0].includes("pg_advisory_lock"),
		);
		const unlockCall = calls.find(
			(c) => typeof c[0] === "string" && c[0].includes("pg_advisory_unlock"),
		);
		expect(lockCall).toBeDefined();
		expect(unlockCall).toBeDefined();
		expect(lockCall?.[1]).toEqual([PG_MIGRATION_LOCK_KEY]);
		expect(unlockCall?.[1]).toEqual([PG_MIGRATION_LOCK_KEY]);

		// Unlock must come AFTER the migration SQL
		const lockIdx = calls.indexOf(lockCall as never);
		const unlockIdx = calls.indexOf(unlockCall as never);
		const ddlIdx = calls.findIndex(
			(c) => typeof c[0] === "string" && c[0].includes("CREATE TABLE foo"),
		);
		expect(ddlIdx).toBeGreaterThan(lockIdx);
		expect(unlockIdx).toBeGreaterThan(ddlIdx);
	});

	it("uses ON CONFLICT DO NOTHING when recording the version", async () => {
		seedMigrations({ "001-x.sql": "CREATE TABLE x (id TEXT);" });
		mockQuery.mockResolvedValue({ rows: [] });
		const pool = new pg.Pool({ connectionString: "postgres://x" });
		await applyPgMigrations(pool, MIGRATIONS_DIR);

		const insertCall = mockQuery.mock.calls.find(
			(c) =>
				typeof c[0] === "string" &&
				c[0].includes("INSERT INTO schema_migrations"),
		);
		expect(insertCall).toBeDefined();
		expect(insertCall?.[0]).toMatch(/ON CONFLICT \(version\) DO NOTHING/);
	});

	it("releases the client and unlocks even when a migration throws", async () => {
		seedMigrations({ "001-bad.sql": "CREATE TABLE explode (id TEXT);" });
		// Sequence: schema_migrations DDL ok → SELECT applied → executeSql FAILS
		mockQuery.mockImplementation(async (sql: string) => {
			if (sql.includes("CREATE TABLE explode")) {
				throw new Error("boom");
			}
			return { rows: [] };
		});
		const pool = new pg.Pool({ connectionString: "postgres://x" });
		await expect(applyPgMigrations(pool, MIGRATIONS_DIR)).rejects.toThrow(
			/boom/,
		);

		// Even though the migration threw, the lock was released and the client returned to the pool.
		expect(
			mockQuery.mock.calls.some(
				(c) => typeof c[0] === "string" && c[0].includes("pg_advisory_unlock"),
			),
		).toBe(true);
		expect(mockRelease).toHaveBeenCalled();
	});

	it("is a no-op when there are no migration files", async () => {
		seedMigrations({});
		mockQuery.mockResolvedValue({ rows: [] });
		const pool = new pg.Pool({ connectionString: "postgres://x" });
		const results = await applyPgMigrations(pool, MIGRATIONS_DIR);
		expect(results).toEqual([]);
		// Lock + schema_migrations DDL + SELECT applied + unlock = at least 4 calls
		expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(4);
	});
});
