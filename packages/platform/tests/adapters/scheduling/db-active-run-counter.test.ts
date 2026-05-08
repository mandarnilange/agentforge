/**
 * Tests for DbActiveRunCounter — queries agent_runs to compute live load
 * across replicas (P45-T6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("pg", () => {
	class MockPool {
		query = mockQuery;
		end = vi.fn();
	}
	return { default: { Pool: MockPool } };
});

import { DbActiveRunCounter } from "../../../src/adapters/scheduling/db-active-run-counter.js";

describe("DbActiveRunCounter", () => {
	let counter: DbActiveRunCounter;

	beforeEach(() => {
		vi.clearAllMocks();
		counter = new DbActiveRunCounter("postgresql://localhost/test");
	});

	it("count() queries agent_runs filtered by node and active status", async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });
		const n = await counter.count("worker-a");
		expect(n).toBe(3);
		const sql = mockQuery.mock.calls[0][0] as string;
		expect(sql).toMatch(/FROM agent_runs/);
		expect(sql).toMatch(/node_name\s*=\s*\$1/);
		expect(sql).toMatch(/status\s*=\s*ANY/i);
		const params = mockQuery.mock.calls[0][1] as unknown[];
		expect(params).toContain("worker-a");
	});

	it("count() passes ACTIVE_STATUSES as a single array parameter", async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
		await counter.count("worker-a");
		const params = mockQuery.mock.calls[0][1] as unknown[];
		const arrayParam = params.find((p) => Array.isArray(p)) as string[];
		expect(arrayParam).toEqual(
			expect.arrayContaining(["pending", "scheduled", "running"]),
		);
	});

	it("count() returns 0 when no rows match (exercises the rows[0] fallback)", async () => {
		// Empty result set is the actual no-row case; the previous
		// [{count: "0"}] mock skipped the fallback path entirely.
		mockQuery.mockResolvedValueOnce({ rows: [] });
		expect(await counter.count("worker-a")).toBe(0);
	});

	it("recordStarted/recordCompleted are no-ops (DB is the source of truth)", async () => {
		await counter.recordStarted("worker-a");
		await counter.recordCompleted("worker-a");
		expect(mockQuery).not.toHaveBeenCalled();
	});
});
