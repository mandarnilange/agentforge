/**
 * Multi-worker HTTP dispatch integration test.
 *
 * Boots a real control-plane HTTP server (SqliteStateStore + pendingRunQueues
 * + handleControlPlaneRoute) and attaches N in-process polling workers that
 * register/heartbeat/poll/report via fetch — exactly what the Docker
 * `worker` entrypoint does in production.
 *
 * Covers the gap where DockerAgentExecutor and NodeWorker each had unit
 * tests but nothing proved the N-worker HTTP loop end to end.
 */

import { existsSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import {
	type ControlPlaneRouteContext,
	handleControlPlaneRoute,
} from "agentforge-core/dashboard/routes/control-plane-routes.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
} from "agentforge-core/domain/ports/agent-executor.port.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEST_DB = "/tmp/multi-worker-integration-test.db";

interface WorkerSpec {
	name: string;
	capabilities: string[];
	maxConcurrentRuns: number;
	executor: IAgentExecutor;
}

interface RunningWorker {
	spec: WorkerSpec;
	stop: () => Promise<void>;
	executed: string[];
}

function makeOkResult(overrides: Partial<AgentJobResult> = {}): AgentJobResult {
	return {
		status: "succeeded",
		artifacts: [],
		savedFiles: [],
		tokenUsage: { inputTokens: 10, outputTokens: 5 },
		costUsd: 0,
		durationMs: 50,
		conversationLog: [],
		...overrides,
	};
}

function makeJob(runId: string, agentId = "analyst"): AgentJob {
	return {
		runId,
		agentId,
		agentDefinition: {
			metadata: { name: agentId },
			spec: { executor: "pi-ai" },
		},
		inputs: [],
		workdir: "/tmp/work",
		outputDir: "/tmp/out",
		model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 64000 },
	};
}

/** Start an in-process worker that registers + polls via HTTP, matching node-start.ts. */
function startWorker(
	port: number,
	spec: WorkerSpec,
	pollIntervalMs = 20,
	heartbeatIntervalMs = 50,
): Promise<RunningWorker> {
	const base = `http://127.0.0.1:${port}`;
	const executed: string[] = [];
	let activeRuns = 0;
	let stopped = false;

	return (async () => {
		const registerRes = await fetch(`${base}/api/v1/nodes/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				definition: {
					metadata: { name: spec.name, type: "remote" },
					spec: {
						capabilities: spec.capabilities,
						resources: { maxConcurrentRuns: spec.maxConcurrentRuns },
					},
				},
			}),
		});
		if (!registerRes.ok) {
			throw new Error(
				`worker ${spec.name} registration failed: ${registerRes.status}`,
			);
		}

		const heartbeat = setInterval(async () => {
			if (stopped) return;
			try {
				await fetch(`${base}/api/v1/nodes/${spec.name}/heartbeat`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ activeRuns }),
				});
			} catch {
				// best effort
			}
		}, heartbeatIntervalMs);

		const poll = setInterval(async () => {
			if (stopped) return;
			try {
				const res = await fetch(
					`${base}/api/v1/nodes/${spec.name}/pending-runs`,
				);
				if (!res.ok) return;
				const { runs } = (await res.json()) as { runs: AgentJob[] };
				for (const job of runs) {
					activeRuns++;
					void (async () => {
						try {
							const result = await spec.executor.execute(job);
							executed.push(job.runId);
							await fetch(`${base}/api/v1/runs/${job.runId}/result`, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									result: {
										runId: job.runId,
										success: result.status === "succeeded",
										result: {
											artifacts: result.artifacts,
											tokenUsage: result.tokenUsage,
											durationMs: result.durationMs,
											events: [],
										},
										error: result.error,
										durationMs: result.durationMs,
										conversationLog: result.conversationLog,
									},
								}),
							});
						} finally {
							activeRuns--;
						}
					})();
				}
			} catch {
				// best effort
			}
		}, pollIntervalMs);

		return {
			spec,
			executed,
			stop: async () => {
				stopped = true;
				clearInterval(heartbeat);
				clearInterval(poll);
				// Drain any in-flight executions for clean teardown
				const deadline = Date.now() + 1000;
				while (activeRuns > 0 && Date.now() < deadline) {
					await new Promise((r) => setTimeout(r, 10));
				}
			},
		};
	})();
}

async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMs = 5000,
	intervalMs = 20,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

describe("Multi-worker HTTP dispatch integration", { timeout: 30_000 }, () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;
	let server: Server;
	let port: number;
	let pendingRunQueues: Map<string, AgentJob[]>;
	let workers: RunningWorker[];

	beforeEach(async () => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		eventBus = new InMemoryEventBus();
		pendingRunQueues = new Map();
		workers = [];

		const ctx: ControlPlaneRouteContext = {
			store,
			eventBus,
			pendingRunQueues,
		};

		server = createServer(async (req, res) => {
			const handled = await handleControlPlaneRoute(req, res, ctx);
			if (!handled) {
				res.writeHead(404);
				res.end();
			}
		});

		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
		const addr = server.address();
		if (!addr || typeof addr === "string") throw new Error("no address");
		port = addr.port;
	});

	afterEach(async () => {
		await Promise.all(workers.map((w) => w.stop()));
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	/**
	 * Pre-create pipeline + N agent_runs rows so POST /result can update
	 * them. Returns the store-generated run ids (the store ignores any `id`
	 * field on CreateAgentRunInput and assigns its own UUID).
	 */
	async function seedRuns(count: number): Promise<string[]> {
		const pipeline = await store.createPipelineRun({
			projectName: "multi-worker-test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			const run = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "unassigned",
				status: "scheduled",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});
			ids.push(run.id);
		}
		return ids;
	}

	it("20 jobs across 3 workers — each job runs exactly once", async () => {
		const makeExecutor = (): IAgentExecutor => ({
			execute: async () => {
				await new Promise((r) => setTimeout(r, 10 + Math.random() * 30));
				return makeOkResult();
			},
		});

		workers = await Promise.all([
			startWorker(port, {
				name: "worker-a",
				capabilities: ["llm-access", "docker"],
				maxConcurrentRuns: 3,
				executor: makeExecutor(),
			}),
			startWorker(port, {
				name: "worker-b",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 3,
				executor: makeExecutor(),
			}),
			startWorker(port, {
				name: "worker-c",
				capabilities: ["llm-access", "gpu"],
				maxConcurrentRuns: 3,
				executor: makeExecutor(),
			}),
		]);

		// Wait for registrations to land in the store
		await waitFor(async () => (await store.listNodes()).length === 3);

		const runIds = await seedRuns(20);

		// Round-robin dispatch: simulates what a scheduler would do
		const jobs = runIds.map((id) => makeJob(id));
		const workerNames = ["worker-a", "worker-b", "worker-c"];
		for (let i = 0; i < jobs.length; i++) {
			const name = workerNames[i % workerNames.length];
			const queue = pendingRunQueues.get(name) ?? [];
			queue.push(jobs[i]);
			pendingRunQueues.set(name, queue);
		}

		await waitFor(async () => {
			const runs = await Promise.all(runIds.map((id) => store.getAgentRun(id)));
			return runs.every((r) => r?.status === "succeeded");
		}, 10_000);

		const allExecuted = workers.flatMap((w) => w.executed).sort();
		expect(allExecuted).toEqual(runIds.slice().sort());

		// No job executed twice
		const seen = new Set<string>();
		for (const id of allExecuted) {
			expect(seen.has(id), `duplicate execution of ${id}`).toBe(false);
			seen.add(id);
		}

		// Work actually spread across workers (round-robin enqueue ⇒ each ~ 6-7)
		for (const w of workers) {
			expect(w.executed.length).toBeGreaterThan(0);
		}
	});

	it("capability-routed jobs land only on capable workers", async () => {
		const dockerExecutor: IAgentExecutor = {
			execute: async () => makeOkResult(),
		};
		const gpuExecutor: IAgentExecutor = {
			execute: async () => makeOkResult(),
		};
		const plainExecutor: IAgentExecutor = {
			execute: async () => makeOkResult(),
		};

		workers = await Promise.all([
			startWorker(port, {
				name: "docker-worker",
				capabilities: ["llm-access", "docker"],
				maxConcurrentRuns: 2,
				executor: dockerExecutor,
			}),
			startWorker(port, {
				name: "gpu-worker",
				capabilities: ["llm-access", "gpu"],
				maxConcurrentRuns: 2,
				executor: gpuExecutor,
			}),
			startWorker(port, {
				name: "plain-worker",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 2,
				executor: plainExecutor,
			}),
		]);

		await waitFor(async () => (await store.listNodes()).length === 3);

		const [dockerJobId, gpuJobId, plainJobId] = await seedRuns(3);

		// Scheduler routes by capability: we emulate that routing here
		pendingRunQueues.set("docker-worker", [makeJob(dockerJobId)]);
		pendingRunQueues.set("gpu-worker", [makeJob(gpuJobId)]);
		pendingRunQueues.set("plain-worker", [makeJob(plainJobId)]);

		await waitFor(async () => {
			const runs = await Promise.all([
				store.getAgentRun(dockerJobId),
				store.getAgentRun(gpuJobId),
				store.getAgentRun(plainJobId),
			]);
			return runs.every((r) => r?.status === "succeeded");
		});

		const byName = Object.fromEntries(workers.map((w) => [w.spec.name, w]));
		expect(byName["docker-worker"].executed).toEqual([dockerJobId]);
		expect(byName["gpu-worker"].executed).toEqual([gpuJobId]);
		expect(byName["plain-worker"].executed).toEqual([plainJobId]);
	});

	it("worker dropping offline leaves its queue undrained; survivors keep working", async () => {
		const executor: IAgentExecutor = {
			execute: async () => {
				await new Promise((r) => setTimeout(r, 10));
				return makeOkResult();
			},
		};

		workers = await Promise.all([
			startWorker(port, {
				name: "survivor-1",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 2,
				executor,
			}),
			startWorker(port, {
				name: "survivor-2",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 2,
				executor,
			}),
			startWorker(port, {
				name: "doomed",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 2,
				executor,
			}),
		]);

		await waitFor(async () => (await store.listNodes()).length === 3);

		// Kill the doomed worker before any work lands on it
		const doomed = workers.find((w) => w.spec.name === "doomed");
		if (!doomed) throw new Error("doomed worker missing");
		await doomed.stop();

		const [liveA, liveB, orphan] = await seedRuns(3);

		pendingRunQueues.set("survivor-1", [makeJob(liveA)]);
		pendingRunQueues.set("survivor-2", [makeJob(liveB)]);
		pendingRunQueues.set("doomed", [makeJob(orphan)]);

		// Survivors finish their work
		await waitFor(async () => {
			const r1 = await store.getAgentRun(liveA);
			const r2 = await store.getAgentRun(liveB);
			return r1?.status === "succeeded" && r2?.status === "succeeded";
		});

		// Orphan stays stuck — reconciler would later mark it failed; here
		// we just prove the worker protocol did not silently drop it.
		const orphanRun = await store.getAgentRun(orphan);
		expect(orphanRun?.status).not.toBe("succeeded");

		// The doomed worker never reported a result
		expect(doomed.executed).not.toContain(orphan);
	});

	it("per-worker concurrency — one worker, many jobs, all complete", async () => {
		let inFlight = 0;
		let maxInFlight = 0;

		const executor: IAgentExecutor = {
			execute: async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 30));
				inFlight--;
				return makeOkResult();
			},
		};

		workers = [
			await startWorker(port, {
				name: "busy-worker",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 5,
				executor,
			}),
		];

		await waitFor(async () => (await store.listNodes()).length === 1);

		const runIds = await seedRuns(10);
		pendingRunQueues.set(
			"busy-worker",
			runIds.map((id) => makeJob(id)),
		);

		await waitFor(async () => {
			const runs = await Promise.all(runIds.map((id) => store.getAgentRun(id)));
			return runs.every((r) => r?.status === "succeeded");
		}, 10_000);

		// A polling worker picks up multiple jobs in one poll and fires them
		// concurrently. We don't assert a hard lower bound (timing-dependent)
		// but concurrency > 1 should be observed here.
		expect(maxInFlight).toBeGreaterThan(1);
		expect(workers[0].executed.sort()).toEqual(runIds.slice().sort());
	});
});
