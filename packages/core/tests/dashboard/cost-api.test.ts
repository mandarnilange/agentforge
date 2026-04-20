import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/dashboard/server.js";
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
				resolve({ status: res.statusCode ?? 500, body: JSON.parse(raw) });
			});
		});
		req.on("error", reject);
		req.end();
	});
}

interface CostSummary {
	totalCostUsd: number;
	byPipeline: Array<{ id: string; name: string; cost: number }>;
	byAgent: Array<{ name: string; cost: number }>;
	byModel: Array<{ provider: string; model: string; cost: number }>;
}

describe("GET /api/v1/cost-summary", () => {
	let server: Server;
	let store: SqliteStateStore;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		const p1 = await store.createPipelineRun({
			projectName: "project-a",
			pipelineName: "sdlc",
			status: "completed",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const p2 = await store.createPipelineRun({
			projectName: "project-b",
			pipelineName: "fast-track",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});

		// Pipeline 1 runs
		await store.createAgentRun({
			pipelineRunId: p1.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		const runs1 = await store.listAgentRuns(p1.id);
		await store.updateAgentRun(runs1[0].id, {
			costUsd: 0.05,
			provider: "anthropic",
			modelName: "claude-3",
		});

		await store.createAgentRun({
			pipelineRunId: p1.id,
			agentName: "architect",
			phase: 2,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		const runs1b = await store.listAgentRuns(p1.id);
		await store.updateAgentRun(runs1b[1].id, {
			costUsd: 0.03,
			provider: "anthropic",
			modelName: "claude-3",
		});

		// Pipeline 2 run
		await store.createAgentRun({
			pipelineRunId: p2.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		const runs2 = await store.listAgentRuns(p2.id);
		await store.updateAgentRun(runs2[0].id, {
			costUsd: 0.02,
			provider: "openai",
			modelName: "gpt-4",
		});

		server = createDashboardServer({ store });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	it("returns cost summary with correct total", async () => {
		const port = getPort(server);
		const { status, body } = await get(port, "/api/v1/cost-summary");
		expect(status).toBe(200);
		const summary = body as CostSummary;
		expect(summary.totalCostUsd).toBeCloseTo(0.1, 4);
	});

	it("breaks down cost by pipeline", async () => {
		const port = getPort(server);
		const { body } = await get(port, "/api/v1/cost-summary");
		const summary = body as CostSummary;
		expect(summary.byPipeline).toHaveLength(2);
		const projectA = summary.byPipeline.find((p) => p.name === "project-a");
		expect(projectA?.cost).toBeCloseTo(0.08, 4);
	});

	it("breaks down cost by agent", async () => {
		const port = getPort(server);
		const { body } = await get(port, "/api/v1/cost-summary");
		const summary = body as CostSummary;
		const analyst = summary.byAgent.find((a) => a.name === "analyst");
		expect(analyst?.cost).toBeCloseTo(0.07, 4);
		const architect = summary.byAgent.find((a) => a.name === "architect");
		expect(architect?.cost).toBeCloseTo(0.03, 4);
	});

	it("breaks down cost by model", async () => {
		const port = getPort(server);
		const { body } = await get(port, "/api/v1/cost-summary");
		const summary = body as CostSummary;
		const anthropic = summary.byModel.find((m) => m.provider === "anthropic");
		expect(anthropic?.cost).toBeCloseTo(0.08, 4);
		const openai = summary.byModel.find((m) => m.provider === "openai");
		expect(openai?.cost).toBeCloseTo(0.02, 4);
	});
});
