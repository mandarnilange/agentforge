import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import type { IAgentScheduler } from "../../src/control-plane/scheduler.js";
import {
	createDashboardServer,
	type DashboardServerOptions,
} from "../../src/dashboard/server.js";
import { parsePipelineDefinition } from "../../src/definitions/parser.js";
import { createDefinitionStore } from "../../src/definitions/store.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-dashboard-test.db";
const OUT_DIR = "/tmp/sdlc-agent-dashboard-output";

describe("dashboard server", () => {
	let store: SqliteStateStore;
	let server: ReturnType<typeof createDashboardServer>;
	let baseUrl: string;
	let pipelineId = "";
	let runId = "";
	let gateId = "";

	beforeAll(async () => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
		mkdirSync(OUT_DIR, { recursive: true });

		store = new SqliteStateStore(TEST_DB);
		await store.upsertNode({
			name: "local",
			type: "local",
			capabilities: ["llm-access", "git"],
			maxConcurrentRuns: 2,
			status: "online",
			activeRuns: 1,
			lastHeartbeat: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const pipeline = await store.createPipelineRun({
			projectName: "demo-project",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});
		pipelineId = pipeline.id;

		const artifactPath = join(OUT_DIR, "frd.json");
		writeFileSync(artifactPath, JSON.stringify({ title: "FRD" }, null, 2));
		const conversationPath = join(OUT_DIR, "analyst-conversation.jsonl");
		writeFileSync(
			conversationPath,
			[
				JSON.stringify({ role: "user", content: "Build me a product" }),
				JSON.stringify({ role: "assistant", content: "Here is the FRD" }),
			].join("\n"),
		);

		const run = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [artifactPath],
			provider: "anthropic",
			modelName: "claude-sonnet-4-20250514",
			costUsd: 0.0123,
			tokenUsage: { inputTokens: 1200, outputTokens: 800 },
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});
		runId = run.id;

		const gate = await store.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [artifactPath],
		});
		gateId = gate.id;

		server = createDashboardServer(store, new GateController(store));
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		if (!addr || typeof addr === "string")
			throw new Error("server did not bind");
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
	});

	// --- static file serving (P11-T2) ---

	it("serves index.html at root /", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		const ct = res.headers.get("content-type") ?? "";
		expect(ct).toContain("text/html");
		const body = await res.text();
		expect(body).toContain('<div id="root">');
	});

	it("serves static JS assets with correct MIME type", async () => {
		// Find an actual JS asset from the build
		const indexRes = await fetch(`${baseUrl}/`);
		const html = await indexRes.text();
		const jsMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
		if (!jsMatch) return; // skip if no built assets yet
		const res = await fetch(`${baseUrl}${jsMatch[1]}`);
		expect(res.status).toBe(200);
		const ct = res.headers.get("content-type") ?? "";
		expect(ct).toContain("javascript");
	});

	it("serves SPA fallback — unknown client routes return index.html", async () => {
		const res = await fetch(`${baseUrl}/pipelines/some-id`);
		expect(res.status).toBe(200);
		const ct = res.headers.get("content-type") ?? "";
		expect(ct).toContain("text/html");
		const body = await res.text();
		expect(body).toContain('<div id="root">');
	});

	it("returns 404 JSON for unknown API routes", async () => {
		const res = await fetch(`${baseUrl}/api/v1/nonexistent`);
		expect(res.status).toBe(404);
		const json = (await res.json()) as { error: string };
		expect(json.error).toBe("Not found");
	});

	// --- existing API tests ---

	it("serves summary endpoint", async () => {
		const res = await fetch(`${baseUrl}/api/v1/summary`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			pipelineCount: number;
			nodeCount: number;
		};
		expect(json.pipelineCount).toBe(1);
		expect(json.nodeCount).toBe(1);
	});

	it("serves pipelines and pipeline detail endpoints", async () => {
		const list = await fetch(`${baseUrl}/api/v1/pipelines`);
		expect(list.status).toBe(200);
		const items = (await list.json()) as Array<{ id: string }>;
		expect(items[0].id).toBe(pipelineId);

		const detail = await fetch(`${baseUrl}/api/v1/pipelines/${pipelineId}`);
		expect(detail.status).toBe(200);
		const json = (await detail.json()) as {
			run: { id: string };
			runs: unknown[];
			gates: unknown[];
		};
		expect(json.run.id).toBe(pipelineId);
		expect(json.runs.length).toBe(1);
		expect(json.gates.length).toBe(1);
	});

	it("serves run detail, logs, artifacts, and conversation endpoints", async () => {
		const run = await fetch(`${baseUrl}/api/v1/runs/${runId}`);
		expect(run.status).toBe(200);
		const runJson = (await run.json()) as { id: string; costUsd: number };
		expect(runJson.id).toBe(runId);
		expect(runJson.costUsd).toBeCloseTo(0.0123, 4);

		const artifacts = await fetch(`${baseUrl}/api/v1/runs/${runId}/artifacts`);
		expect(artifacts.status).toBe(200);
		const artifactsJson = (await artifacts.json()) as Array<{ path: string }>;
		expect(artifactsJson).toHaveLength(1);

		const convo = await fetch(`${baseUrl}/api/v1/runs/${runId}/conversation`);
		expect(convo.status).toBe(200);
		const convoJson = (await convo.json()) as Array<{ role: string }>;
		expect(convoJson).toHaveLength(2);

		const logs = await fetch(`${baseUrl}/api/v1/runs/${runId}/logs`);
		expect(logs.status).toBe(200);
		const logsJson = (await logs.json()) as {
			conversation: unknown[];
			artifacts: unknown[];
		};
		expect(logsJson.conversation).toHaveLength(2);
		expect(logsJson.artifacts).toHaveLength(1);
	});

	it("serves nodes and gates endpoints", async () => {
		const nodes = await fetch(`${baseUrl}/api/v1/nodes`);
		expect(nodes.status).toBe(200);
		const nodeJson = (await nodes.json()) as Array<{ name: string }>;
		expect(nodeJson[0].name).toBe("local");

		const node = await fetch(`${baseUrl}/api/v1/nodes/local`);
		expect(node.status).toBe(200);

		const gates = await fetch(
			`${baseUrl}/api/v1/gates?pipelineId=${pipelineId}`,
		);
		expect(gates.status).toBe(200);
		const gateJson = (await gates.json()) as Array<{ id: string }>;
		expect(gateJson[0].id).toBe(gateId);
	});

	it("serves the dashboard page at /dashboard", async () => {
		const res = await fetch(`${baseUrl}/dashboard`);
		expect(res.status).toBe(200);
		const ct = res.headers.get("content-type") ?? "";
		expect(ct).toContain("text/html");
		const body = await res.text();
		expect(body).toContain('<div id="root">');
	});

	it("monitoring: summary reflects paused pipeline and pending gate", async () => {
		const res = await fetch(`${baseUrl}/api/v1/summary`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			pausedPipelines: number;
			pendingGates: number;
		};
		expect(json.pausedPipelines).toBe(1);
		expect(json.pendingGates).toBe(1);
	});

	it("monitoring: pipeline detail shows phase in waiting-gate status", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipelines/${pipelineId}`);
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			phaseSummary: Array<{ phase: number; status: string }>;
		};
		const phase1 = json.phaseSummary.find((p) => p.phase === 1);
		expect(phase1?.status).toBe("waiting-gate");
	});

	it("dashboard serves React SPA with root mount point", async () => {
		const res = await fetch(`${baseUrl}/dashboard`);
		expect(res.status).toBe(200);
		const body = await res.text();
		// React SPA has a root div and loads JS bundle
		expect(body).toContain('<div id="root">');
		expect(body).toContain("<script");
	});

	it("serves full artifact content without truncation", async () => {
		const artifactPath = join(OUT_DIR, "frd.json");
		const res = await fetch(
			`${baseUrl}/api/v1/artifact-content?path=${encodeURIComponent(artifactPath)}`,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { path: string; content: unknown };
		expect(json.path).toBe(artifactPath);
		expect(json.content).toEqual({ title: "FRD" });
	});

	it("returns 400 for artifact-content without path param", async () => {
		const res = await fetch(`${baseUrl}/api/v1/artifact-content`);
		expect(res.status).toBe(400);
	});

	it("returns 404 for artifact-content with non-existent path", async () => {
		const res = await fetch(
			`${baseUrl}/api/v1/artifact-content?path=${encodeURIComponent("/nonexistent/file.json")}`,
		);
		expect(res.status).toBe(404);
	});

	it("generates PDF from artifact", async () => {
		const artifactPath = join(OUT_DIR, "frd.json");
		const res = await fetch(
			`${baseUrl}/api/v1/artifact-pdf?path=${encodeURIComponent(artifactPath)}`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect(res.headers.get("content-disposition")).toContain("frd.pdf");
		const buf = Buffer.from(await res.arrayBuffer());
		expect(buf.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("returns 400 for artifact-pdf without path param", async () => {
		const res = await fetch(`${baseUrl}/api/v1/artifact-pdf`);
		expect(res.status).toBe(400);
	});

	it("returns pending gates across all pipelines", async () => {
		const res = await fetch(`${baseUrl}/api/v1/gates/pending`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as Array<{
			id: string;
			status: string;
			projectName: string;
		}>;
		expect(data.length).toBe(1);
		expect(data[0].status).toBe("pending");
		expect(data[0].projectName).toBe("demo-project");
		expect(data[0].id).toBe(gateId);
	});

	it("returns empty pipeline definitions without definition store", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipeline-definitions`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as unknown[];
		expect(data).toEqual([]);
	});
});

describe("dashboard gate actions (POST)", () => {
	const DB = "/tmp/sdlc-agent-dashboard-gate-actions-test.db";
	let store: SqliteStateStore;
	let server: ReturnType<typeof createDashboardServer>;
	let baseUrl: string;
	let gateApproveId = "";
	let gateRejectId = "";
	let gateReviseId = "";
	let pipelineId = "";

	beforeAll(async () => {
		if (existsSync(DB)) rmSync(DB);
		store = new SqliteStateStore(DB);

		const pipeline = await store.createPipelineRun({
			projectName: "gate-action-project",
			pipelineName: "gate-test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		pipelineId = pipeline.id;

		gateApproveId = (
			await store.createGate({
				pipelineRunId: pipelineId,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			})
		).id;
		gateRejectId = (
			await store.createGate({
				pipelineRunId: pipelineId,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			})
		).id;
		gateReviseId = (
			await store.createGate({
				pipelineRunId: pipelineId,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			})
		).id;

		server = createDashboardServer(store, new GateController(store));
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		if (!addr || typeof addr === "string")
			throw new Error("server did not bind");
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await store.close();
		if (existsSync(DB)) rmSync(DB);
	});

	it("POST /api/v1/gates/:id/approve approves a pending gate", async () => {
		const res = await fetch(
			`${baseUrl}/api/v1/gates/${gateApproveId}/approve`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ reviewer: "operator", comment: "LGTM" }),
			},
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { status: string; reviewer: string };
		expect(json.status).toBe("approved");
		expect(json.reviewer).toBe("operator");
	});

	it("POST /api/v1/gates/:id/reject rejects a pending gate", async () => {
		const res = await fetch(`${baseUrl}/api/v1/gates/${gateRejectId}/reject`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ reviewer: "operator", comment: "Not ready" }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { status: string };
		expect(json.status).toBe("rejected");
	});

	it("POST /api/v1/gates/:id/revise requests revision on a pending gate", async () => {
		const res = await fetch(`${baseUrl}/api/v1/gates/${gateReviseId}/revise`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				reviewer: "operator",
				notes: "Please add error handling",
			}),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			status: string;
			revisionNotes: string;
		};
		expect(json.status).toBe("revision_requested");
		expect(json.revisionNotes).toBe("Please add error handling");
	});

	it("POST gate action on non-existent gate returns 400", async () => {
		const res = await fetch(`${baseUrl}/api/v1/gates/nonexistent/approve`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("POST gate action without gate controller returns 503", async () => {
		const noControllerServer = createDashboardServer(store);
		const port = await new Promise<number>((resolve) => {
			noControllerServer.listen(0, "127.0.0.1", () => {
				const addr = noControllerServer.address() as { port: number };
				resolve(addr.port);
			});
		});
		const res = await fetch(
			`http://127.0.0.1:${port}/api/v1/gates/${gateApproveId}/approve`,
			{ method: "POST" },
		);
		expect(res.status).toBe(503);
		await new Promise<void>((resolve, reject) =>
			noControllerServer.close((err) => (err ? reject(err) : resolve())),
		);
	});

	it("monitoring: active pipeline appears in summary", async () => {
		const res = await fetch(`${baseUrl}/api/v1/summary`);
		const json = (await res.json()) as { pipelineCount: number };
		expect(json.pipelineCount).toBe(1);
	});
});

describe("dashboard pipeline operations (P14)", () => {
	const DB = "/tmp/sdlc-agent-dashboard-pipeline-ops-test.db";
	let store: SqliteStateStore;
	let server: ReturnType<typeof createDashboardServer>;
	let baseUrl: string;

	const PIPELINE_YAML = `
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: test-pipeline
  displayName: Test Pipeline
  description: A test pipeline
spec:
  input:
    - name: brief
      type: raw-brief
      description: Project brief
      required: true
  phases:
    - name: requirements
      phase: 1
      agents:
        - analyst
`;

	beforeAll(async () => {
		if (existsSync(DB)) rmSync(DB);
		store = new SqliteStateStore(DB);
		const defStore = createDefinitionStore();
		defStore.addPipeline(parsePipelineDefinition(PIPELINE_YAML));

		const stubScheduler = {
			schedule: () => ({
				kind: "NodeDefinition" as const,
				apiVersion: "agentforge/v1" as const,
				metadata: { name: "local", displayName: "Local", description: "stub" },
				spec: {
					host: "localhost",
					maxConcurrency: 1,
					capabilities: [] as string[],
				},
			}),
			recordRunStarted: () => {},
			recordRunCompleted: () => {},
			getActiveRunCount: () => 0,
		} satisfies IAgentScheduler;
		const gateCtrl = new GateController(store);
		const pipelineCtrl = new PipelineController(store, gateCtrl, stubScheduler);
		const opts: DashboardServerOptions = {
			store,
			gateController: gateCtrl,
			pipelineController: pipelineCtrl,
			definitionStore: defStore,
			executePipeline: () => Promise.resolve(),
		};
		server = createDashboardServer(opts);
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		if (!addr || typeof addr === "string")
			throw new Error("server did not bind");
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await store.close();
		if (existsSync(DB)) rmSync(DB);
	});

	it("GET /api/v1/pipeline-definitions returns available definitions", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipeline-definitions`);
		expect(res.status).toBe(200);
		const data = (await res.json()) as Array<{
			name: string;
			displayName: string;
			inputs: unknown[];
		}>;
		expect(data.length).toBe(1);
		expect(data[0].name).toBe("test-pipeline");
		expect(data[0].displayName).toBe("Test Pipeline");
		expect(data[0].inputs.length).toBe(1);
	});

	it("POST /api/v1/pipelines returns 400 without required fields", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("POST /api/v1/pipelines returns 400 for unknown definition", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: "nonexistent",
				projectName: "test",
			}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("not found");
	});

	it("POST /api/v1/pipelines/{id}/stop cancels a running pipeline", async () => {
		// First create a pipeline
		const createRes = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: "test-pipeline",
				projectName: "stop-test",
			}),
		});
		const createBody = await createRes.json();
		expect(createRes.status).toBe(201);
		const created = createBody as { id: string; status: string };
		expect(created.status).toBe("running");

		// Stop the pipeline
		const stopRes = await fetch(
			`${baseUrl}/api/v1/pipelines/${created.id}/stop`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(stopRes.status).toBe(200);
		const stopped = (await stopRes.json()) as { id: string; status: string };
		expect(stopped.status).toBe("cancelled");

		// Verify agent runs are also cancelled
		const runsRes = await fetch(`${baseUrl}/api/v1/pipelines/${created.id}`);
		const detail = (await runsRes.json()) as {
			runs: Array<{ status: string }>;
		};
		for (const r of detail.runs) {
			expect(r.status).toBe("failed");
		}
	});

	it("POST /api/v1/pipelines/{id}/stop returns 400 for non-running pipeline", async () => {
		// Create and stop a pipeline first
		const createRes = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: "test-pipeline",
				projectName: "stop-error-test",
			}),
		});
		const created = (await createRes.json()) as { id: string };

		// Stop it
		await fetch(`${baseUrl}/api/v1/pipelines/${created.id}/stop`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		// Try to stop again — should fail
		const res = await fetch(`${baseUrl}/api/v1/pipelines/${created.id}/stop`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("Cannot stop");
	});

	it("POST /api/v1/pipelines/{id}/retry re-runs a failed/cancelled pipeline", async () => {
		// Create and stop a pipeline
		const createRes = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: "test-pipeline",
				projectName: "retry-test",
			}),
		});
		const created = (await createRes.json()) as { id: string };
		await fetch(`${baseUrl}/api/v1/pipelines/${created.id}/stop`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		// Retry the pipeline
		const retryRes = await fetch(
			`${baseUrl}/api/v1/pipelines/${created.id}/retry`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(retryRes.status).toBe(200);
		const retried = (await retryRes.json()) as {
			id: string;
			status: string;
			currentPhase: number;
		};
		expect(retried.status).toBe("running");
		expect(retried.currentPhase).toBe(1);

		// Verify new agent runs were created
		const detailRes = await fetch(`${baseUrl}/api/v1/pipelines/${created.id}`);
		const detail = (await detailRes.json()) as {
			runs: Array<{ status: string }>;
		};
		const pendingRuns = detail.runs.filter((r) => r.status === "pending");
		expect(pendingRuns.length).toBeGreaterThan(0);
	});

	it("POST /api/v1/pipelines/{id}/retry returns 400 for running pipeline", async () => {
		const createRes = await fetch(`${baseUrl}/api/v1/pipelines`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: "test-pipeline",
				projectName: "retry-error-test",
			}),
		});
		const created = (await createRes.json()) as { id: string };

		const res = await fetch(`${baseUrl}/api/v1/pipelines/${created.id}/retry`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const json = (await res.json()) as { error: string };
		expect(json.error).toContain("Cannot retry");
	});
});

describe("dashboard pipeline stop/retry read-only mode", () => {
	const DB = "/tmp/sdlc-agent-dashboard-readonly-stop-test.db";
	let store: SqliteStateStore;
	let server: ReturnType<typeof createDashboardServer>;
	let baseUrl: string;

	beforeAll(async () => {
		if (existsSync(DB)) rmSync(DB);
		store = new SqliteStateStore(DB);
		// No pipelineController = read-only mode
		const opts: DashboardServerOptions = { store };
		server = createDashboardServer(opts);
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		if (!addr || typeof addr === "string")
			throw new Error("server did not bind");
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await store.close();
		if (existsSync(DB)) rmSync(DB);
	});

	it("POST /api/v1/pipelines/{id}/stop returns 503 in read-only mode", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipelines/fake-id/stop`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(503);
	});

	it("POST /api/v1/pipelines/{id}/retry returns 503 in read-only mode", async () => {
		const res = await fetch(`${baseUrl}/api/v1/pipelines/fake-id/retry`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(503);
	});
});

describe("dashboard server control-plane routes (worker registration)", () => {
	const DB = "/tmp/sdlc-agent-dashboard-cp-test.db";
	let store: SqliteStateStore;
	let server: ReturnType<typeof createDashboardServer>;
	let baseUrl: string;

	beforeAll(async () => {
		if (existsSync(DB)) rmSync(DB);
		store = new SqliteStateStore(DB);
		const { InMemoryEventBus } = await import(
			"../../src/adapters/events/in-memory-event-bus.js"
		);
		const opts: DashboardServerOptions = {
			store,
			eventBus: new InMemoryEventBus(),
		};
		server = createDashboardServer(opts);
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const addr = server.address();
		if (!addr || typeof addr === "string")
			throw new Error("server did not bind");
		baseUrl = `http://127.0.0.1:${addr.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server.close((err) => (err ? reject(err) : resolve())),
		);
		await store.close();
		if (existsSync(DB)) rmSync(DB);
	});

	it("POST /api/v1/nodes/register registers a node and returns 200", async () => {
		const res = await fetch(`${baseUrl}/api/v1/nodes/register`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				definition: {
					metadata: { name: "worker-1", type: "remote" },
					spec: {
						capabilities: ["llm-access"],
						resources: { maxConcurrentRuns: 3 },
					},
				},
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe("registered");
		const node = await store.getNode("worker-1");
		expect(node?.name).toBe("worker-1");
		expect(node?.capabilities).toEqual(["llm-access"]);
	});

	it("POST /api/v1/nodes/{name}/heartbeat updates lastHeartbeat", async () => {
		const res = await fetch(`${baseUrl}/api/v1/nodes/worker-1/heartbeat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ activeRuns: 1 }),
		});
		expect(res.status).toBe(200);
		const node = await store.getNode("worker-1");
		expect(node?.activeRuns).toBe(1);
	});

	it("GET /api/v1/nodes/{name}/pending-runs returns empty queue", async () => {
		const res = await fetch(`${baseUrl}/api/v1/nodes/worker-1/pending-runs`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { runs: unknown[] };
		expect(body.runs).toEqual([]);
	});
});
