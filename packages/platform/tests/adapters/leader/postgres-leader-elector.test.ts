/**
 * Tests for PostgresLeaderElector using a mocked pg client (P45-T5).
 *
 * Uses `pg_try_advisory_lock(<bigint>)` over a single dedicated client so
 * the lock survives only as long as that session — replica crash → lock
 * auto-released → another replica acquires immediately.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClientQuery, mockConnect, mockRelease } = vi.hoisted(() => ({
	mockClientQuery: vi.fn(),
	mockConnect: vi.fn(),
	mockRelease: vi.fn(),
}));

vi.mock("pg", () => {
	class MockPool {
		connect = mockConnect.mockImplementation(async () => ({
			query: mockClientQuery,
			release: mockRelease,
		}));
		end = vi.fn();
	}
	return { default: { Pool: MockPool } };
});

import { PostgresLeaderElector } from "../../../src/adapters/leader/postgres-leader-elector.js";

describe("PostgresLeaderElector", () => {
	let elector: PostgresLeaderElector;

	beforeEach(() => {
		vi.clearAllMocks();
		elector = new PostgresLeaderElector("postgresql://localhost/test");
	});

	it("acquire calls pg_try_advisory_lock and returns true on success", async () => {
		mockClientQuery.mockResolvedValueOnce({
			rows: [{ pg_try_advisory_lock: true }],
		});
		expect(await elector.acquire("agentforge-reconciler")).toBe(true);
		const sql = mockClientQuery.mock.calls[0][0] as string;
		expect(sql).toMatch(/pg_try_advisory_lock/i);
	});

	it("acquire returns false when another holder owns the lock", async () => {
		mockClientQuery.mockResolvedValueOnce({
			rows: [{ pg_try_advisory_lock: false }],
		});
		expect(await elector.acquire("agentforge-reconciler")).toBe(false);
	});

	it("isLeader reflects last successful acquire", async () => {
		mockClientQuery.mockResolvedValueOnce({
			rows: [{ pg_try_advisory_lock: true }],
		});
		await elector.acquire("name-a");
		expect(elector.isLeader("name-a")).toBe(true);
		expect(elector.isLeader("name-b")).toBe(false);
	});

	it("release calls pg_advisory_unlock", async () => {
		mockClientQuery.mockResolvedValueOnce({
			rows: [{ pg_try_advisory_lock: true }],
		});
		await elector.acquire("name-a");
		mockClientQuery.mockResolvedValueOnce({
			rows: [{ pg_advisory_unlock: true }],
		});
		await elector.release("name-a");
		expect(elector.isLeader("name-a")).toBe(false);
		const lastSql = mockClientQuery.mock.calls.at(-1)?.[0] as string;
		expect(lastSql).toMatch(/pg_advisory_unlock/i);
	});

	it("hashes lock names to a stable bigint to avoid collisions", async () => {
		// Two distinct names produce two distinct lock ids; reusing the same
		// name produces the same id (release + re-acquire round-trip).
		mockClientQuery.mockResolvedValue({
			rows: [{ pg_try_advisory_lock: true, pg_advisory_unlock: true }],
		});
		await elector.acquire("agentforge-reconciler");
		const firstParams = mockClientQuery.mock.calls[0][1] as unknown[];
		await elector.release("agentforge-reconciler");
		await elector.acquire("agentforge-reconciler");
		const reAcquireParams = mockClientQuery.mock.calls.at(-1)?.[1] as unknown[];
		expect(reAcquireParams[0]).toBe(firstParams[0]);

		await elector.acquire("agentforge-scheduler");
		const schedulerParams = mockClientQuery.mock.calls.at(-1)?.[1] as unknown[];
		expect(schedulerParams[0]).not.toBe(firstParams[0]);
	});
});
