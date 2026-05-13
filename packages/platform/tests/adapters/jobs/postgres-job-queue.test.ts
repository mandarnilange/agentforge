/**
 * Tests for PostgresJobQueue using a mocked pg.Pool (P45-T4).
 *
 * Verifies the SQL contract: enqueue inserts into agent_jobs, claim uses
 * `FOR UPDATE SKIP LOCKED` so concurrent replicas never see the same row,
 * complete deletes by runId, reclaimStale releases claims older than the
 * threshold.
 */
import type { AgentJob } from "@mandarnilange/agentforge-core/domain/ports/agent-executor.port.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("pg", () => {
	class MockPool {
		query = mockQuery;
		end = vi.fn();
	}
	return { default: { Pool: MockPool } };
});

import { PostgresJobQueue } from "../../../src/adapters/jobs/postgres-job-queue.js";

function job(runId: string): AgentJob {
	return {
		runId,
		agentId: "analyst",
		agentDefinition: { metadata: { name: "analyst" }, spec: {} },
		model: {
			provider: "anthropic",
			name: "claude-sonnet",
			maxTokens: 4096,
		},
		workdir: "/tmp/work",
		outputDir: "/tmp/out",
	} as unknown as AgentJob;
}

describe("PostgresJobQueue", () => {
	let queue: PostgresJobQueue;
	beforeEach(() => {
		vi.clearAllMocks();
		queue = new PostgresJobQueue("postgresql://localhost/test");
	});

	describe("enqueue()", () => {
		it("inserts a row with run_id, node_name and serialized payload", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await queue.enqueue(job("r1"), "worker-a");
			const sql = mockQuery.mock.calls[0][0] as string;
			const params = mockQuery.mock.calls[0][1] as unknown[];
			expect(sql).toMatch(/INSERT INTO agent_jobs/);
			expect(params[0]).toBe("r1");
			expect(params[1]).toBe("worker-a");
			// payload should be JSON-serialized
			expect(JSON.parse(params[2] as string).runId).toBe("r1");
		});
	});

	describe("claim()", () => {
		it("uses FOR UPDATE SKIP LOCKED for atomic claim across replicas", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await queue.claim("worker-a");
			const sql = mockQuery.mock.calls[0][0] as string;
			expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
		});

		it("returns deserialized AgentJob payloads", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{ run_id: "r1", payload: JSON.stringify(job("r1")) },
					{ run_id: "r2", payload: JSON.stringify(job("r2")) },
				],
			});
			const claimed = await queue.claim("worker-a", { limit: 5 });
			expect(claimed.map((j) => j.runId)).toEqual(["r1", "r2"]);
		});

		it("skips rows with corrupted payloads instead of failing the whole claim", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					{ run_id: "ok", payload: JSON.stringify(job("ok")) },
					{ run_id: "bad", payload: "{ not valid json" },
				],
			});
			// 2nd query: the cleanup DELETE for the poisoned row.
			mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
			const claimed = await queue.claim("worker-a", { limit: 5 });
			expect(claimed.map((j) => j.runId)).toEqual(["ok"]);
		});

		it("DELETEs corrupted rows so reclaimStale can't recycle them forever", async () => {
			// Without delete: the row stays claimed_by=worker, JSON.parse keeps
			// throwing, and reclaimStale eventually frees it for another doomed
			// claim — head-of-line poison forever.
			mockQuery.mockResolvedValueOnce({
				rows: [{ run_id: "bad", payload: "not json" }],
			});
			mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
			await queue.claim("worker-a");
			const deleteCall = mockQuery.mock.calls.find(
				(c) =>
					typeof c[0] === "string" &&
					(c[0] as string).match(/DELETE FROM agent_jobs/i),
			);
			expect(deleteCall).toBeDefined();
			expect(deleteCall?.[1]).toEqual([["bad"]]);
		});

		it("filters by node_name and pending claim", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await queue.claim("worker-a", { limit: 3 });
			const params = mockQuery.mock.calls[0][1] as unknown[];
			// worker name and limit should be bound parameters
			expect(params).toContain("worker-a");
			expect(params).toContain(3);
		});
	});

	describe("complete()", () => {
		it("DELETEs the row", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await queue.complete("r1");
			const sql = mockQuery.mock.calls[0][0] as string;
			expect(sql).toMatch(/DELETE FROM agent_jobs/);
			expect(mockQuery.mock.calls[0][1]).toEqual(["r1"]);
		});
	});

	describe("reclaimStale()", () => {
		it("clears claimed_by/claimed_at when claim age exceeds threshold", async () => {
			mockQuery.mockResolvedValueOnce({ rowCount: 2, rows: [] });
			const released = await queue.reclaimStale(60_000);
			expect(released).toBe(2);
			const sql = mockQuery.mock.calls[0][0] as string;
			expect(sql).toMatch(/UPDATE agent_jobs/);
			expect(sql).toMatch(/claimed_by\s*=\s*NULL/i);
			expect(sql).toMatch(/claimed_at\s*=\s*NULL/i);
		});

		it("uses per-job claim_ttl_ms when set, falling back to maxAgeMs", async () => {
			mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
			await queue.reclaimStale(60_000);
			const sql = mockQuery.mock.calls[0][0] as string;
			// SQL should COALESCE per-job ttl with the parameter so each row
			// is checked against its own deadline.
			expect(sql).toMatch(/COALESCE\(claim_ttl_ms/i);
		});
	});

	describe("depth()", () => {
		it("counts rows for a node regardless of claim state", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });
			const d = await queue.depth("worker-a");
			expect(d).toBe(3);
		});
	});
});
