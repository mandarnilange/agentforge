/**
 * Tests for InMemoryJobQueue — single-process default for IJobQueue (P45-T4).
 * Mirrors the contract that PostgresJobQueue must also satisfy.
 */
import { describe, expect, it } from "vitest";
import { InMemoryJobQueue } from "../../../src/adapters/jobs/in-memory-job-queue.js";
import type { AgentJob } from "../../../src/domain/ports/agent-executor.port.js";

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

describe("InMemoryJobQueue", () => {
	it("returns empty when nothing is enqueued", async () => {
		const q = new InMemoryJobQueue();
		const claimed = await q.claim("worker-a");
		expect(claimed).toEqual([]);
	});

	it("returns enqueued job to a single claimer", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		const claimed = await q.claim("worker-a");
		expect(claimed.map((j) => j.runId)).toEqual(["r1"]);
	});

	it("enqueue with a duplicate runId is a no-op (matches Postgres ON CONFLICT DO NOTHING)", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		await q.claim("worker-a"); // r1 is now claimed
		await q.enqueue(job("r1"), "worker-b"); // duplicate runId — must not reset
		const second = await q.claim("worker-a");
		expect(second).toEqual([]); // still claimed, not overwritten
		const onB = await q.claim("worker-b");
		expect(onB).toEqual([]); // never moved to worker-b
	});

	it("does not return the same job twice (claim is exclusive)", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		const first = await q.claim("worker-a");
		const second = await q.claim("worker-a");
		expect(first.map((j) => j.runId)).toEqual(["r1"]);
		expect(second).toEqual([]);
	});

	it("respects limit", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		await q.enqueue(job("r2"), "worker-a");
		await q.enqueue(job("r3"), "worker-a");
		const claimed = await q.claim("worker-a", { limit: 2 });
		expect(claimed.map((j) => j.runId)).toEqual(["r1", "r2"]);
	});

	it("isolates queues per nodeName", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		await q.enqueue(job("r2"), "worker-b");
		const aJobs = await q.claim("worker-a");
		expect(aJobs.map((j) => j.runId)).toEqual(["r1"]);
		const bJobs = await q.claim("worker-b");
		expect(bJobs.map((j) => j.runId)).toEqual(["r2"]);
	});

	it("complete removes the job entirely", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		await q.claim("worker-a");
		await q.complete("r1");
		expect(await q.depth("worker-a")).toBe(0);
		// reclaimStale should not return the completed job
		const reclaimed = await q.reclaimStale(0);
		expect(reclaimed).toBe(0);
	});

	it("reclaimStale returns claimed-but-stale jobs to the pool", async () => {
		const q = new InMemoryJobQueue({ now: () => 1_000 });
		await q.enqueue(job("r1"), "worker-a");
		await q.claim("worker-a", { ttlMs: 100 });
		// advance virtual clock past ttl
		(q as unknown as { _setNow: (n: number) => void })._setNow(2_000);
		const reclaimed = await q.reclaimStale(100);
		expect(reclaimed).toBe(1);
		const reclaimedJobs = await q.claim("worker-a");
		expect(reclaimedJobs.map((j) => j.runId)).toEqual(["r1"]);
	});

	it("reclaimStale honours per-job ttlMs over the maxAgeMs argument", async () => {
		// Job A claimed with a tight 100ms TTL; Job B with the default 300_000ms.
		// At t+200ms (with maxAgeMs=50ms) only A's per-job TTL has elapsed.
		const q = new InMemoryJobQueue({ now: () => 0 });
		await q.enqueue(job("ra"), "worker-a");
		await q.enqueue(job("rb"), "worker-a");
		await q.claim("worker-a", { ttlMs: 100, limit: 1 });
		await q.claim("worker-a", { ttlMs: 300_000, limit: 1 });
		(q as unknown as { _setNow: (n: number) => void })._setNow(200);
		const reclaimed = await q.reclaimStale(50);
		expect(reclaimed).toBe(1);
		const next = await q.claim("worker-a");
		expect(next.map((j) => j.runId)).toEqual(["ra"]);
	});

	it("depth reports both pending and claimed jobs", async () => {
		const q = new InMemoryJobQueue();
		await q.enqueue(job("r1"), "worker-a");
		await q.enqueue(job("r2"), "worker-a");
		expect(await q.depth("worker-a")).toBe(2);
		await q.claim("worker-a", { limit: 1 });
		expect(await q.depth("worker-a")).toBe(2);
		await q.complete("r1");
		expect(await q.depth("worker-a")).toBe(1);
	});
});
