import { existsSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../src/adapters/events/in-memory-event-bus.js";
import {
	type ControlPlaneRouteContext,
	handleControlPlaneRoute,
} from "../../src/dashboard/routes/control-plane-routes.js";
import type { AgentJob } from "../../src/domain/ports/agent-executor.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-cp-routes-test.db";

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

function httpPost(
	port: number,
	path: string,
	body: unknown,
): Promise<{ status: number; data: unknown }> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body);
		const req = httpRequest(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				},
			},
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						resolve({ status: res.statusCode ?? 500, data: JSON.parse(data) });
					} catch {
						resolve({ status: res.statusCode ?? 500, data });
					}
				});
			},
		);
		req.on("error", reject);
		req.write(payload);
		req.end();
	});
}

function httpGet(
	port: number,
	path: string,
): Promise<{ status: number; data: unknown }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(
			{ hostname: "127.0.0.1", port, path, method: "GET" },
			(res) => {
				let data = "";
				res.on("data", (chunk) => (data += chunk));
				res.on("end", () => {
					try {
						resolve({ status: res.statusCode ?? 500, data: JSON.parse(data) });
					} catch {
						resolve({ status: res.statusCode ?? 500, data });
					}
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("Control Plane Routes (P18-T9)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;
	let server: Server;

	beforeEach(() => {
		return new Promise<void>((resolve) => {
			if (existsSync(TEST_DB)) rmSync(TEST_DB);
			store = new SqliteStateStore(TEST_DB);
			eventBus = new InMemoryEventBus();

			const ctx: ControlPlaneRouteContext = { store, eventBus };

			server = createServer(async (req, res) => {
				const handled = await handleControlPlaneRoute(req, res, ctx);
				if (!handled) {
					res.writeHead(404);
					res.end(JSON.stringify({ error: "not found" }));
				}
			});
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("POST /api/v1/nodes/register registers a new node", async () => {
		const port = getPort(server);
		const { status, data } = await httpPost(port, "/api/v1/nodes/register", {
			definition: {
				metadata: { name: "gpu-1", type: "remote" },
				spec: {
					capabilities: ["llm-access", "gpu"],
					resources: { maxConcurrentRuns: 5 },
				},
			},
		});

		expect(status).toBe(200);
		expect((data as Record<string, unknown>).status).toBe("registered");

		const node = await store.getNode("gpu-1");
		expect(node).not.toBeNull();
		expect(node?.type).toBe("remote");
		expect(node?.capabilities).toEqual(["llm-access", "gpu"]);
		expect(node?.status).toBe("online");
	});

	it("POST /api/v1/nodes/:name/heartbeat updates heartbeat", async () => {
		// First register a node
		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: ["llm-access"],
			status: "online",
			activeRuns: 0,
			updatedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status } = await httpPost(port, "/api/v1/nodes/gpu-1/heartbeat", {
			activeRuns: 2,
		});

		expect(status).toBe(200);

		const node = await store.getNode("gpu-1");
		expect(node?.activeRuns).toBe(2);
		expect(node?.lastHeartbeat).toBeTruthy();
	});

	it("GET /api/v1/nodes/:name/pending-runs returns and drains queue", async () => {
		// This tests the endpoint exists and returns empty array by default
		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: ["llm-access"],
			status: "online",
			activeRuns: 0,
			updatedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status, data } = await httpGet(
			port,
			"/api/v1/nodes/gpu-1/pending-runs",
		);

		expect(status).toBe(200);
		expect((data as Record<string, unknown>).runs).toEqual([]);
	});

	it("POST /api/v1/runs/:id/result accepts result", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "gpu-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status } = await httpPost(
			port,
			`/api/v1/runs/${agentRun.id}/result`,
			{
				result: {
					runId: agentRun.id,
					success: true,
					result: {
						artifacts: [],
						tokenUsage: { inputTokens: 100, outputTokens: 200 },
						durationMs: 1000,
						events: [],
					},
					durationMs: 1000,
				},
			},
		);

		expect(status).toBe(200);

		const updated = await store.getAgentRun(agentRun.id);
		expect(updated?.durationMs).toBe(1000);
		expect(updated?.tokenUsage).toEqual({
			inputTokens: 100,
			outputTokens: 200,
		});
	});

	it("POST /api/v1/runs/:id/result accepts failed result (covers else branch)", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "gpu-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status } = await httpPost(
			port,
			`/api/v1/runs/${agentRun.id}/result`,
			{
				result: {
					runId: agentRun.id,
					success: false,
					error: "Agent failed with OOM",
					durationMs: 500,
				},
			},
		);

		expect(status).toBe(200);

		const updated = await store.getAgentRun(agentRun.id);
		expect(updated?.status).toBe("failed");
		expect(updated?.error).toBe("Agent failed with OOM");
	});

	it("returns 404 for unknown routes", async () => {
		const port = getPort(server);
		const { status } = await httpGet(port, "/api/v1/unknown");
		expect(status).toBe(404);
	});
});

describe("Control Plane Routes — pending-runs queue + conversationLog (P18-T18)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;
	let server: Server;
	let pendingRunQueues: Map<string, AgentJob[]>;

	const TEST_DB_T18 = "/tmp/sdlc-cp-routes-t18-test.db";

	beforeEach(() => {
		return new Promise<void>((resolve) => {
			if (existsSync(TEST_DB_T18)) rmSync(TEST_DB_T18);
			store = new SqliteStateStore(TEST_DB_T18);
			eventBus = new InMemoryEventBus();
			pendingRunQueues = new Map();

			const ctx: ControlPlaneRouteContext = {
				store,
				eventBus,
				pendingRunQueues,
			};

			server = createServer(async (req, res) => {
				const handled = await handleControlPlaneRoute(req, res, ctx);
				if (!handled) {
					res.writeHead(404);
					res.end(JSON.stringify({ error: "not found" }));
				}
			});
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
		await store.close();
		if (existsSync(TEST_DB_T18)) rmSync(TEST_DB_T18);
	});

	function makeJob(runId: string): AgentJob {
		return {
			runId,
			agentId: "analyst",
			agentDefinition: {
				metadata: { name: "analyst" },
				spec: { executor: "pi-ai" },
			},
			inputs: [],
			workdir: "/tmp/work",
			outputDir: "/tmp/out",
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4",
				maxTokens: 64000,
			},
		};
	}

	it("GET /api/v1/nodes/:name/pending-runs returns queued runs and drains the queue", async () => {
		const port = getPort(server);
		await httpPost(port, "/api/v1/nodes/register", {
			definition: {
				metadata: { name: "worker-1", type: "remote" },
				spec: {
					capabilities: ["llm-access"],
					resources: { maxConcurrentRuns: 3 },
				},
			},
		});

		// Queue two jobs for worker-1
		pendingRunQueues.set("worker-1", [makeJob("run-A"), makeJob("run-B")]);

		const { status, data } = await httpGet(
			port,
			"/api/v1/nodes/worker-1/pending-runs",
		);

		expect(status).toBe(200);
		const runs = (data as Record<string, unknown>).runs as AgentJob[];
		expect(runs).toHaveLength(2);
		expect(runs[0].runId).toBe("run-A");
		expect(runs[1].runId).toBe("run-B");

		// Queue is drained — second fetch returns empty
		const { data: data2 } = await httpGet(
			port,
			"/api/v1/nodes/worker-1/pending-runs",
		);
		expect((data2 as Record<string, unknown>).runs).toHaveLength(0);
	});

	it("GET /api/v1/nodes/:name/pending-runs returns empty array when no queue exists", async () => {
		const port = getPort(server);
		const { status, data } = await httpGet(
			port,
			"/api/v1/nodes/ghost-node/pending-runs",
		);
		expect(status).toBe(200);
		expect((data as Record<string, unknown>).runs).toEqual([]);
	});

	it("POST /api/v1/runs/:id/result persists conversationLog", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "worker-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status } = await httpPost(
			port,
			`/api/v1/runs/${agentRun.id}/result`,
			{
				result: {
					runId: agentRun.id,
					success: true,
					result: {
						artifacts: [],
						tokenUsage: { inputTokens: 100, outputTokens: 200 },
						durationMs: 1000,
						events: [],
					},
					conversationLog: [
						{ role: "user", content: "build it" },
						{ role: "assistant", content: "done" },
					],
					durationMs: 1000,
				},
			},
		);

		expect(status).toBe(200);

		// Verify conversationLog was persisted
		const log = await store.getConversationLog(agentRun.id);
		expect(log).toHaveLength(2);
		expect(log[0].role).toBe("user");
		expect(log[1].role).toBe("assistant");
	});

	it("POST /api/v1/runs/:id/result works without conversationLog (backward compat)", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "worker-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const port = getPort(server);
		const { status } = await httpPost(
			port,
			`/api/v1/runs/${agentRun.id}/result`,
			{
				result: {
					runId: agentRun.id,
					success: true,
					result: {
						artifacts: [],
						tokenUsage: { inputTokens: 50, outputTokens: 100 },
						durationMs: 500,
						events: [],
					},
					durationMs: 500,
					// no conversationLog
				},
			},
		);

		expect(status).toBe(200);
		const updated = await store.getAgentRun(agentRun.id);
		expect(updated?.status).toBe("succeeded");
	});
});
