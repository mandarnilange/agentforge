/**
 * Tests for api-routes.ts — covers uncovered endpoints and error cases.
 */
import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateController } from "../../src/control-plane/gate-controller.js";
import type { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import { createDashboardServer } from "../../src/dashboard/server.js";
import type { DefinitionStore } from "../../src/definitions/store.js";
import { SqliteStateStore } from "../../src/state/store.js";

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

function get(
	port: number,
	path: string,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ hostname: "127.0.0.1", port, path }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				try {
					resolve({ status: res.statusCode ?? 500, body: JSON.parse(raw) });
				} catch {
					resolve({ status: res.statusCode ?? 500, body: raw });
				}
			});
		});
		req.on("error", reject);
		req.end();
	});
}

function post(
	port: number,
	path: string,
	body: unknown,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const req = httpRequest(
			{
				hostname: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"content-type": "application/json",
					"content-length": Buffer.byteLength(data),
				},
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (c: Buffer) => chunks.push(c));
				res.on("end", () => {
					const raw = Buffer.concat(chunks).toString("utf-8");
					try {
						resolve({ status: res.statusCode ?? 500, body: JSON.parse(raw) });
					} catch {
						resolve({ status: res.statusCode ?? 500, body: raw });
					}
				});
			},
		);
		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

describe("API routes — uncovered endpoints", () => {
	let server: Server;
	let store: SqliteStateStore;
	let port: number;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		server = createDashboardServer({ store });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		port = getPort(server);
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	describe("GET /api/health", () => {
		it("returns status ok", async () => {
			const { status, body } = await get(port, "/api/health");
			expect(status).toBe(200);
			expect((body as Record<string, unknown>).status).toBe("ok");
		});
	});

	describe("GET /api/v1/artifacts", () => {
		it("returns empty list when no pipeline specified", async () => {
			const { status, body } = await get(port, "/api/v1/artifacts");
			expect(status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
		});

		it("filters by pipelineId when provided", async () => {
			const { status } = await get(
				port,
				"/api/v1/artifacts?pipelineId=missing",
			);
			expect(status).toBe(200);
		});
	});

	describe("GET /api/v1/pipelines/:id", () => {
		it("returns 404 when pipeline not found", async () => {
			const { status, body } = await get(port, "/api/v1/pipelines/nonexistent");
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});

		it("returns pipeline when found", async () => {
			const run = await store.createPipelineRun({
				projectName: "test-project",
				pipelineName: "test-pipeline",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const { status } = await get(port, `/api/v1/pipelines/${run.id}`);
			expect(status).toBe(200);
		});
	});

	describe("GET /api/v1/runs", () => {
		it("returns 400 when pipelineId is missing", async () => {
			const { status, body } = await get(port, "/api/v1/runs");
			expect(status).toBe(400);
			expect((body as Record<string, unknown>).error).toContain("pipelineId");
		});

		it("returns runs for valid pipelineId", async () => {
			const run = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "pipeline",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const { status, body } = await get(
				port,
				`/api/v1/runs?pipelineId=${run.id}`,
			);
			expect(status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
		});
	});

	describe("GET /api/v1/runs/:id", () => {
		it("returns 404 when run not found", async () => {
			const { status, body } = await get(port, "/api/v1/runs/nonexistent");
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/runs/:id/artifacts", () => {
		it("returns 404 when run not found", async () => {
			const { status, body } = await get(
				port,
				"/api/v1/runs/nonexistent/artifacts",
			);
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/runs/:id/conversation", () => {
		it("returns 404 when run not found", async () => {
			const { status, body } = await get(
				port,
				"/api/v1/runs/nonexistent/conversation",
			);
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/runs/:id/logs", () => {
		it("returns 404 when run not found", async () => {
			const { status, body } = await get(port, "/api/v1/runs/nonexistent/logs");
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/nodes/:name", () => {
		it("returns 404 when node not found", async () => {
			const { status, body } = await get(port, "/api/v1/nodes/nonexistent");
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/gates", () => {
		it("returns 400 when pipelineId is missing", async () => {
			const { status, body } = await get(port, "/api/v1/gates");
			expect(status).toBe(400);
			expect((body as Record<string, unknown>).error).toContain("pipelineId");
		});

		it("returns 200 with empty list when pipelineId is provided", async () => {
			const { status, body } = await get(
				port,
				"/api/v1/gates?pipelineId=any-id",
			);
			expect(status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
		});
	});

	describe("GET /api/v1/gates/:id", () => {
		it("returns 404 when gate not found", async () => {
			const { status, body } = await get(port, "/api/v1/gates/nonexistent");
			expect(status).toBe(404);
			expect((body as Record<string, unknown>).error).toContain("not found");
		});
	});

	describe("GET /api/v1/artifact-content", () => {
		it("returns 400 when path param is missing", async () => {
			const { status } = await get(port, "/api/v1/artifact-content");
			expect(status).toBe(400);
		});

		it("returns 404 when artifact not found", async () => {
			const { status } = await get(
				port,
				"/api/v1/artifact-content?path=/nonexistent/file.json",
			);
			expect(status).toBe(404);
		});
	});

	describe("GET /api/v1/artifact-pdf", () => {
		it("returns 400 when path param is missing", async () => {
			const { status } = await get(port, "/api/v1/artifact-pdf");
			expect(status).toBe(400);
		});

		it("returns 404 when artifact not found", async () => {
			const { status } = await get(
				port,
				"/api/v1/artifact-pdf?path=/nonexistent/file.json",
			);
			expect(status).toBe(404);
		});
	});
});

describe("API routes — POST gate actions (read-only mode)", () => {
	let server: Server;
	let store: SqliteStateStore;
	let port: number;
	let gateController: GateController;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		gateController = new GateController(store);
		server = createDashboardServer({ store, gateController });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		port = getPort(server);
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	async function createTestPipelineAndGate(): Promise<{
		pipelineId: string;
		gateId: string;
	}> {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const gate = await store.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [],
		});
		return { pipelineId: pipeline.id, gateId: gate.id };
	}

	it("returns 503 for POST /api/v1/pipelines when no pipelineController", async () => {
		const { status } = await post(port, "/api/v1/pipelines", {
			definition: "standard-sdlc",
			projectName: "test",
		});
		expect(status).toBe(503);
	});

	it("returns 503 for POST /api/v1/pipelines when executePipeline is absent (no API key)", async () => {
		const store2 = new SqliteStateStore(":memory:");
		const mockPC = {
			startPipeline: vi.fn(),
			stopPipeline: vi.fn(),
			retryPipeline: vi.fn(),
			getPipelineRun: vi.fn(),
		};
		const mockDS = {
			getPipeline: () => ({
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [] },
			}),
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};
		const server2 = createDashboardServer({
			store: store2,
			gateController: new GateController(store2),
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPC as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDS as any,
			// executePipeline intentionally omitted — simulates missing API key
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = getPort(server2);

		const { status, body } = await post(port2, "/api/v1/pipelines", {
			definition: "standard-sdlc",
			projectName: "test",
		});
		expect(status).toBe(503);
		expect((body as Record<string, unknown>).error).toContain(
			"ANTHROPIC_API_KEY",
		);
		expect(mockPC.startPipeline).not.toHaveBeenCalled();

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});

	it("returns 503 for POST /api/v1/pipelines/:id/stop when no pipelineController", async () => {
		const { status } = await post(port, "/api/v1/pipelines/pipe-1/stop", {});
		expect(status).toBe(503);
	});

	it("approves a gate via POST (read-only mode with gateController)", async () => {
		const { gateId } = await createTestPipelineAndGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/approve`,
			{ reviewer: "alice", comment: "LGTM" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("approved");
	});

	it("rejects a gate via POST (read-only mode)", async () => {
		const { gateId } = await createTestPipelineAndGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/reject`,
			{ reviewer: "bob", comment: "Not ready" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("rejected");
	});

	it("revises a gate via POST (read-only mode)", async () => {
		const { gateId } = await createTestPipelineAndGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/revise`,
			{ notes: "Please update the FRD", reviewer: "alice" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("revision_requested");
	});

	it("returns 400 when gate not found for approve", async () => {
		const { status, body } = await post(
			port,
			"/api/v1/gates/nonexistent-gate/approve",
			{ reviewer: "alice" },
		);
		expect(status).toBe(400);
		expect((body as Record<string, unknown>).error).toBeDefined();
	});

	it("returns 503 when no gateController for gate actions", async () => {
		// Create a server without gateController
		const store2 = new SqliteStateStore(":memory:");
		const server2 = createDashboardServer({ store: store2 });
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = getPort(server2);

		const { status } = await post(port2, "/api/v1/gates/some-gate/approve", {});
		expect(status).toBe(503);

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});

	it("returns 404 for unknown POST route", async () => {
		const { status } = await post(port, "/api/v1/unknown-endpoint", {});
		expect(status).toBe(404);
	});

	it("returns gate when gate exists (GET /api/v1/gates/:id)", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const gate = await store.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [],
		});
		const { status, body } = await get(port, `/api/v1/gates/${gate.id}`);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).id).toBe(gate.id);
	});

	it("returns 400 for malformed JSON body in POST", async () => {
		// Send raw bytes that aren't valid JSON — triggers readBody catch block
		const badData = "not-json-{";
		const { status } = await new Promise<{ status: number; body: unknown }>(
			(resolve, reject) => {
				const req = httpRequest(
					{
						hostname: "127.0.0.1",
						port,
						path: "/api/v1/gates/some-gate/approve",
						method: "POST",
						headers: {
							"content-type": "application/json",
							"content-length": Buffer.byteLength(badData),
						},
					},
					(res) => {
						const chunks: Buffer[] = [];
						res.on("data", (c: Buffer) => chunks.push(c));
						res.on("end", () => {
							const raw = Buffer.concat(chunks).toString("utf-8");
							try {
								resolve({
									status: res.statusCode ?? 500,
									body: JSON.parse(raw),
								});
							} catch {
								resolve({ status: res.statusCode ?? 500, body: raw });
							}
						});
					},
				);
				req.on("error", reject);
				req.write(badData);
				req.end();
			},
		);
		// With malformed JSON, readBody resolves to {} and the gate is not found → 400
		expect(status).toBe(400);
	});
});

describe("API routes — POST gate actions with PipelineController", () => {
	let server: Server;
	let store: SqliteStateStore;
	let port: number;
	let gateController: GateController;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		gateController = new GateController(store);

		// Mock pipeline controller that delegates to real gateController
		const mockPipelineController = {
			approveGate: async (
				gateId: string,
				_def: unknown,
				reviewer?: string,
				comment?: string,
			) => {
				await gateController.approve(gateId, reviewer, comment);
			},
			rejectGate: async (
				gateId: string,
				reviewer?: string,
				comment?: string,
			) => {
				await gateController.reject(gateId, reviewer, comment);
			},
			reviseGate: async (gateId: string, notes: string, reviewer?: string) => {
				await gateController.revise(gateId, notes, reviewer);
			},
		};

		// Mock definition store that returns a pipeline def
		const mockDefinitionStore = {
			getPipeline: () => ({
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [{ phase: 2, agents: ["architect"] }] },
			}),
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		server = createDashboardServer({
			store,
			gateController,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPipelineController as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDefinitionStore as any,
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		port = getPort(server);
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	async function createTestGate(): Promise<{
		pipelineId: string;
		gateId: string;
	}> {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const gate = await store.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [],
		});
		return { pipelineId: pipeline.id, gateId: gate.id };
	}

	it("approve gate via pipelineController advances gate to approved", async () => {
		const { gateId } = await createTestGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/approve`,
			{ reviewer: "alice", comment: "LGTM" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("approved");
	});

	it("reject gate via pipelineController changes gate to rejected", async () => {
		const { gateId } = await createTestGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/reject`,
			{ reviewer: "bob", comment: "Not ready" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("rejected");
	});

	it("revise gate via pipelineController changes gate to revision_requested", async () => {
		const { gateId } = await createTestGate();
		const { status, body } = await post(
			port,
			`/api/v1/gates/${gateId}/revise`,
			{ notes: "Please update the spec", reviewer: "alice" },
		);
		expect(status).toBe(200);
		expect((body as Record<string, unknown>).status).toBe("revision_requested");
	});

	it("falls back to gateController.approve when pipelineDef not found", async () => {
		// Override mock to return undefined pipelineDef
		const mockDefinitionStoreNoMatch: DefinitionStore = {
			getPipeline: () => undefined,
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		const mockPipelineController = {
			approveGate: async () => {},
			rejectGate: async () => {},
			reviseGate: async () => {},
		} as unknown as PipelineController;

		const server2 = createDashboardServer({
			store,
			gateController,
			pipelineController: mockPipelineController,
			definitionStore: mockDefinitionStoreNoMatch,
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = (server2.address() as { port: number }).port;

		const { gateId } = await createTestGate();
		const { status } = await post(port2, `/api/v1/gates/${gateId}/approve`, {
			reviewer: "alice",
		});
		// With no pipelineDef, falls back to gateController.approve (else branch)
		expect(status).toBe(200);

		await new Promise<void>((resolve) => server2.close(() => resolve()));
	});

	it("returns 400 when gate not found with pipelineController", async () => {
		const { status } = await post(
			port,
			"/api/v1/gates/nonexistent-gate/approve",
			{ reviewer: "alice" },
		);
		expect(status).toBe(400);
	});
});

describe("API routes — executePipeline callback coverage", () => {
	it("fires executePipeline when approve gate succeeds (covers line 354)", async () => {
		const store2 = new SqliteStateStore(":memory:");
		const gateController2 = new GateController(store2);
		const executePipelineFn = vi.fn();

		const pipeline = await store2.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const gate = await store2.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [],
		});

		const mockPC = {
			approveGate: async (
				gateId: string,
				_def: unknown,
				reviewer?: string,
				comment?: string,
			) => {
				await gateController2.approve(gateId, reviewer, comment);
			},
			rejectGate: async (
				gateId: string,
				reviewer?: string,
				comment?: string,
			) => {
				await gateController2.reject(gateId, reviewer, comment);
			},
			reviseGate: async (gateId: string, notes: string, reviewer?: string) => {
				await gateController2.revise(gateId, notes, reviewer);
			},
		};
		const mockDS = {
			getPipeline: () => ({
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [{ phase: 2, agents: ["architect"] }] },
			}),
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		const server2 = createDashboardServer({
			store: store2,
			gateController: gateController2,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPC as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDS as any,
			executePipeline: executePipelineFn,
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = (server2.address() as { port: number }).port;

		const { status } = await post(port2, `/api/v1/gates/${gate.id}/approve`, {
			reviewer: "alice",
		});
		expect(status).toBe(200);
		expect(executePipelineFn).toHaveBeenCalledOnce();

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});

	it("fires executePipeline when revise gate succeeds (covers line 375)", async () => {
		const store2 = new SqliteStateStore(":memory:");
		const gateController2 = new GateController(store2);
		const executePipelineFn = vi.fn();

		const pipeline = await store2.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const gate = await store2.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [],
		});

		const mockPC = {
			approveGate: async () => {},
			rejectGate: async () => {},
			reviseGate: async (gateId: string, notes: string, reviewer?: string) => {
				await gateController2.revise(gateId, notes, reviewer);
			},
		};
		const mockDS = {
			getPipeline: () => ({
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [] },
			}),
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		const server2 = createDashboardServer({
			store: store2,
			gateController: gateController2,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPC as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDS as any,
			executePipeline: executePipelineFn,
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = (server2.address() as { port: number }).port;

		const { status } = await post(port2, `/api/v1/gates/${gate.id}/revise`, {
			notes: "Fix it",
			reviewer: "alice",
		});
		expect(status).toBe(200);
		expect(executePipelineFn).toHaveBeenCalledOnce();

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});

	it("fires executePipeline when retry pipeline succeeds (covers line 303)", async () => {
		const store2 = new SqliteStateStore(":memory:");
		const executePipelineFn = vi.fn();

		const pipeline = await store2.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "failed",
			currentPhase: 1,
			inputs: { userPrompt: "build a SaaS CRM" },
			startedAt: new Date().toISOString(),
		});

		const mockPC = {
			getPipelineRun: async (id: string) => {
				return await store2.getPipelineRun(id);
			},
			retryPipeline: async (id: string) => {
				await store2.updatePipelineRun(id, { status: "running" });
				return await store2.getPipelineRun(id);
			},
			stopPipeline: async () => {},
		};
		const mockDS = {
			getPipeline: () => ({
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [] },
			}),
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		const server2 = createDashboardServer({
			store: store2,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPC as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDS as any,
			executePipeline: executePipelineFn,
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = (server2.address() as { port: number }).port;

		const { status } = await post(
			port2,
			`/api/v1/pipelines/${pipeline.id}/retry`,
			{},
		);
		expect(status).toBe(200);
		expect(executePipelineFn).toHaveBeenCalledOnce();
		expect(executePipelineFn).toHaveBeenCalledWith(
			pipeline.id,
			"test",
			expect.any(Object),
			{ userPrompt: "build a SaaS CRM" },
		);

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});

	it("returns 404 when pipeline run not found during retry (covers line 285)", async () => {
		const store2 = new SqliteStateStore(":memory:");

		const mockPC = {
			getPipelineRun: async (_id: string) => null, // returns null → triggers 404 branch
			retryPipeline: async () => {},
			stopPipeline: async () => {},
		};
		const mockDS = {
			getPipeline: () => undefined,
			getAgent: () => undefined,
			getNode: () => undefined,
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			listAgents: () => [],
			listPipelines: () => [],
			listNodes: () => [],
			clear: () => {},
		};

		const server2 = createDashboardServer({
			store: store2,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			pipelineController: mockPC as any,
			// biome-ignore lint/suspicious/noExplicitAny: test mock
			definitionStore: mockDS as any,
		});
		await new Promise<void>((resolve) =>
			server2.listen(0, "127.0.0.1", () => resolve()),
		);
		const port2 = (server2.address() as { port: number }).port;

		const { status, body } = await post(
			port2,
			"/api/v1/pipelines/nonexistent/retry",
			{},
		);
		expect(status).toBe(404);
		expect((body as Record<string, unknown>).error).toContain("not found");

		await new Promise<void>((resolve) => server2.close(() => resolve()));
		await store2.close();
	});
});

describe("GET /api/v1/agents / /pipeline-defs / /node-defs — definition list & detail", () => {
	function makeDefinitionStoreWith9Agents(): DefinitionStore {
		const agents = Array.from({ length: 9 }).map((_, i) => ({
			apiVersion: "agentforge/v1",
			kind: "AgentDefinition" as const,
			metadata: { name: `agent-${i}`, phase: "1" },
			spec: {
				executor: "pi-ai" as const,
				systemPrompt: { file: "x.md" },
			},
		}));
		const pipelines = [
			{
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition" as const,
				metadata: { name: "standard-sdlc" },
				spec: { phases: [] },
			},
		];
		const nodes = [
			{
				apiVersion: "agentforge/v1",
				kind: "NodeDefinition" as const,
				metadata: { name: "local" },
				spec: { connection: { type: "local" }, capabilities: [] },
			},
		];
		return {
			addAgent: () => {},
			addPipeline: () => {},
			addNode: () => {},
			getAgent: (name: string) => agents.find((a) => a.metadata.name === name),
			getPipeline: (name: string) =>
				pipelines.find((p) => p.metadata.name === name),
			getNode: (name: string) => nodes.find((n) => n.metadata.name === name),
			listAgents: () => agents,
			listPipelines: () => pipelines,
			listNodes: () => nodes,
			clear: () => {},
			// biome-ignore lint/suspicious/noExplicitAny: partial fixtures satisfy the route handler
		} as any as DefinitionStore;
	}

	async function startServer(
		definitionStore: DefinitionStore,
	): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
		const store = new SqliteStateStore(":memory:");
		const server = createDashboardServer({ store, definitionStore });
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		const port = getPort(server);
		return {
			server,
			port,
			close: async () => {
				await new Promise<void>((resolve) => server.close(() => resolve()));
				await store.close();
			},
		};
	}

	it("GET /api/v1/agents lists all agent definitions loaded in the store", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status, body } = await get(port, "/api/v1/agents");
			expect(status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
			const list = body as Array<Record<string, unknown>>;
			expect(list).toHaveLength(9);
			expect(list[0].name).toBe("agent-0");
			expect(list[0].kind).toBe("AgentDefinition");
			expect(typeof list[0].version).toBe("number");
		} finally {
			await close();
		}
	});

	it("GET /api/v1/agents returns [] when no definitionStore is wired", async () => {
		const store = new SqliteStateStore(":memory:");
		const server = createDashboardServer({ store });
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", () => resolve()),
		);
		const port = getPort(server);
		try {
			const { status, body } = await get(port, "/api/v1/agents");
			expect(status).toBe(200);
			expect(body).toEqual([]);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await store.close();
		}
	});

	it("GET /api/v1/agents/:name returns detail with specYaml when found", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status, body } = await get(port, "/api/v1/agents/agent-3");
			expect(status).toBe(200);
			const detail = body as Record<string, unknown>;
			expect(detail.name).toBe("agent-3");
			expect(detail.kind).toBe("AgentDefinition");
			expect(typeof detail.specYaml).toBe("string");
			expect((detail.specYaml as string).length).toBeGreaterThan(0);
			expect(detail.specYaml).toContain("agent-3");
		} finally {
			await close();
		}
	});

	it("GET /api/v1/agents/:name returns 404 when not found", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status } = await get(port, "/api/v1/agents/nope");
			expect(status).toBe(404);
		} finally {
			await close();
		}
	});

	it("GET /api/v1/pipeline-defs lists pipeline definitions", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status, body } = await get(port, "/api/v1/pipeline-defs");
			expect(status).toBe(200);
			const list = body as Array<Record<string, unknown>>;
			expect(list).toHaveLength(1);
			expect(list[0].name).toBe("standard-sdlc");
			expect(list[0].kind).toBe("PipelineDefinition");
		} finally {
			await close();
		}
	});

	it("GET /api/v1/pipeline-defs/:name returns detail with specYaml", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status, body } = await get(
				port,
				"/api/v1/pipeline-defs/standard-sdlc",
			);
			expect(status).toBe(200);
			const detail = body as Record<string, unknown>;
			expect(detail.name).toBe("standard-sdlc");
			expect(typeof detail.specYaml).toBe("string");
		} finally {
			await close();
		}
	});

	it("GET /api/v1/node-defs lists node definitions", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status, body } = await get(port, "/api/v1/node-defs");
			expect(status).toBe(200);
			const list = body as Array<Record<string, unknown>>;
			expect(list).toHaveLength(1);
			expect(list[0].name).toBe("local");
			expect(list[0].kind).toBe("NodeDefinition");
		} finally {
			await close();
		}
	});

	it("GET /api/v1/node-defs/:name returns 404 when not found", async () => {
		const { port, close } = await startServer(makeDefinitionStoreWith9Agents());
		try {
			const { status } = await get(port, "/api/v1/node-defs/nope");
			expect(status).toBe(404);
		} finally {
			await close();
		}
	});
});

describe("GET /api/v1/status", () => {
	it("returns readOnly true when no executePipeline is configured", async () => {
		const store = new SqliteStateStore(":memory:");
		const server = createDashboardServer({ store });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const port = getPort(server);

		const { status, body } = await get(port, "/api/v1/status");
		expect(status).toBe(200);
		const data = body as { readOnly: boolean; hasDefinitions: boolean };
		expect(data.readOnly).toBe(true);
		expect(data.hasDefinitions).toBe(false);

		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	it("returns readOnly false when executePipeline is configured", async () => {
		const store = new SqliteStateStore(":memory:");
		const server = createDashboardServer({
			store,
			executePipeline: vi.fn(),
		});
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const port = getPort(server);

		const { status, body } = await get(port, "/api/v1/status");
		expect(status).toBe(200);
		const data = body as { readOnly: boolean };
		expect(data.readOnly).toBe(false);

		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});
});
