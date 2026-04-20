import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DashboardResourceService } from "../../src/application/dashboard/resource-service.js";
import type { PipelineDefinitionYaml } from "../../src/definitions/parser.js";
import type { DefinitionStore } from "../../src/definitions/store.js";
import { SqliteStateStore } from "../../src/state/store.js";

/**
 * Minimal in-memory DefinitionStore that exposes pipelines with named phases.
 * Used to exercise summarizePhases / listPendingGates behaviour that
 * depends on the live pipeline definition.
 */
function makeDefStore(
	pipelines: Record<string, PipelineDefinitionYaml>,
): DefinitionStore {
	return {
		addAgent: () => {},
		getAgent: () => undefined,
		listAgents: () => [],
		addPipeline: () => {},
		getPipeline: (name: string) => pipelines[name],
		listPipelines: () => Object.values(pipelines),
		addNode: () => {},
		getNode: () => undefined,
		listNodes: () => [],
	} as unknown as DefinitionStore;
}

function sdlcPipelineDef(): PipelineDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "PipelineDefinition",
		metadata: { name: "standard-sdlc" },
		spec: {
			phases: [
				{ name: "Requirements", phase: 1, agents: ["analyst"] },
				{ name: "Architecture", phase: 2, agents: ["architect"] },
				{ name: "Planning", phase: 3, agents: ["planner"] },
				{ name: "Implementation", phase: 4, agents: ["developer"] },
				{ name: "QA", phase: 5, agents: ["qa"] },
				{ name: "DevOps", phase: 6, agents: ["devops"] },
			],
		},
	} as PipelineDefinitionYaml;
}

const TEST_DB = "/tmp/sdlc-resource-service-test.db";
const OUT_DIR = "/tmp/sdlc-resource-service-out";

describe("DashboardResourceService", () => {
	let store: SqliteStateStore;
	let service: DashboardResourceService;
	let pipelineId: string;
	let runId: string;
	let gateId: string;

	beforeAll(async () => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
		mkdirSync(OUT_DIR, { recursive: true });

		store = new SqliteStateStore(TEST_DB);
		service = new DashboardResourceService(
			store,
			makeDefStore({ "standard-sdlc": sdlcPipelineDef() }),
		);

		await store.upsertNode({
			name: "local",
			type: "local",
			capabilities: ["llm-access"],
			maxConcurrentRuns: 2,
			status: "online",
			activeRuns: 0,
			lastHeartbeat: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const pipeline = await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "standard-sdlc",
			status: "paused_at_gate",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});
		pipelineId = pipeline.id;

		const artifactPath = join(OUT_DIR, "frd.json");
		writeFileSync(
			artifactPath,
			JSON.stringify({ title: "FRD", content: "test" }),
		);

		const conversationPath = join(OUT_DIR, "analyst-conversation.jsonl");
		writeFileSync(
			conversationPath,
			[
				JSON.stringify({ role: "user", content: "Hello" }),
				JSON.stringify({ role: "assistant", content: "World" }),
			].join("\n"),
		);

		const run = await store.createAgentRun({
			pipelineRunId: pipelineId,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [artifactPath],
			provider: "anthropic",
			modelName: "claude-sonnet-4-20250514",
			costUsd: 0.025,
			tokenUsage: { inputTokens: 1000, outputTokens: 800 },
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});
		runId = run.id;

		const gate = await store.createGate({
			pipelineRunId: pipelineId,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "pending",
			artifactVersionIds: [artifactPath],
		});
		gateId = gate.id;
	});

	afterAll(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
	});

	describe("getSummary()", () => {
		it("returns pipeline and node counts", async () => {
			const summary = await service.getSummary();
			expect(summary.pipelineCount).toBe(1);
			expect(summary.nodeCount).toBe(1);
			expect(summary.onlineNodes).toBe(1);
			expect(summary.pendingGates).toBe(1);
			expect(summary.runCount).toBe(1);
			expect(summary.totalCostUsd).toBeCloseTo(0.025);
		});

		it("counts paused pipelines", async () => {
			const summary = await service.getSummary();
			expect(summary.pausedPipelines).toBe(1);
			expect(summary.runningPipelines).toBe(0);
		});
	});

	describe("listPipelines()", () => {
		it("returns all pipeline runs", async () => {
			const pipelines = await service.listPipelines();
			expect(pipelines.length).toBeGreaterThanOrEqual(1);
			expect(pipelines.some((p) => p.id === pipelineId)).toBe(true);
		});
	});

	describe("getPipeline()", () => {
		it("returns pipeline detail with runs and gates", async () => {
			const detail = await service.getPipeline(pipelineId);
			expect(detail).not.toBeNull();
			expect(detail?.run.id).toBe(pipelineId);
			expect(detail?.runs.length).toBeGreaterThanOrEqual(1);
			expect(detail?.gates.length).toBeGreaterThanOrEqual(1);
		});

		it("returns null for unknown pipeline", async () => {
			const detail = await service.getPipeline("nonexistent-id");
			expect(detail).toBeNull();
		});

		it("includes phase summary with all phases from the pipeline definition", async () => {
			const detail = await service.getPipeline(pipelineId);
			expect(detail?.phaseSummary).toHaveLength(6);
			const phases = detail?.phaseSummary.map((p) => p.phase);
			expect(phases).toContain(1);
			expect(phases).toContain(6);
		});

		it("populates phase names from the pipeline definition", async () => {
			const detail = await service.getPipeline(pipelineId);
			const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
			expect(phase1?.name).toBe("Requirements");
			const phase4 = detail?.phaseSummary.find((p) => p.phase === 4);
			expect(phase4?.name).toBe("Implementation");
		});

		it("marks phase 1 as waiting-gate", async () => {
			const detail = await service.getPipeline(pipelineId);
			const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
			expect(phase1?.status).toBe("waiting-gate");
		});
	});

	describe("listRuns()", () => {
		it("returns agent runs for a pipeline", async () => {
			const runs = await service.listRuns(pipelineId);
			expect(runs.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("getRun()", () => {
		it("returns an agent run by ID", async () => {
			const run = await service.getRun(runId);
			expect(run).not.toBeNull();
			expect(run?.id).toBe(runId);
		});

		it("returns null for unknown run", async () => {
			const run = await service.getRun("nonexistent");
			expect(run).toBeNull();
		});
	});

	describe("getRunArtifacts()", () => {
		it("returns artifacts for a run", async () => {
			const artifacts = await service.getRunArtifacts(runId);
			expect(artifacts).not.toBeNull();
			expect(artifacts?.length).toBeGreaterThanOrEqual(1);
			expect(artifacts?.[0].path).toContain("frd.json");
		});

		it("returns null for unknown run", async () => {
			const artifacts = await service.getRunArtifacts("nonexistent");
			expect(artifacts).toBeNull();
		});
	});

	describe("getRunConversation()", () => {
		it("returns conversation entries for a run", async () => {
			const conv = await service.getRunConversation(runId);
			expect(conv).not.toBeNull();
			expect(conv?.length).toBeGreaterThanOrEqual(2);
			expect(conv?.[0].role).toBe("user");
		});

		it("returns null for unknown run", async () => {
			const conv = await service.getRunConversation("nonexistent");
			expect(conv).toBeNull();
		});
	});

	describe("getRunLogs()", () => {
		it("returns run, conversation, and artifacts", async () => {
			const logs = await service.getRunLogs(runId);
			expect(logs).not.toBeNull();
			expect(logs?.run.id).toBe(runId);
			expect(Array.isArray(logs?.conversation)).toBe(true);
			expect(Array.isArray(logs?.artifacts)).toBe(true);
		});

		it("returns null for unknown run", async () => {
			const logs = await service.getRunLogs("nonexistent");
			expect(logs).toBeNull();
		});
	});

	describe("listNodes()", () => {
		it("returns all nodes", async () => {
			const nodes = await service.listNodes();
			expect(nodes.length).toBeGreaterThanOrEqual(1);
			expect(nodes.some((n) => n.name === "local")).toBe(true);
		});
	});

	describe("getNode()", () => {
		it("returns a node by name", async () => {
			const node = await service.getNode("local");
			expect(node).not.toBeNull();
			expect(node?.name).toBe("local");
		});

		it("returns null for unknown node", async () => {
			const node = await service.getNode("nonexistent");
			expect(node).toBeNull();
		});
	});

	describe("listGates()", () => {
		it("returns gates for a pipeline", async () => {
			const gates = await service.listGates(pipelineId);
			expect(gates.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("listPendingGates()", () => {
		it("returns pending gates enriched with project/pipeline names", async () => {
			const pending = await service.listPendingGates();
			expect(pending.length).toBeGreaterThanOrEqual(1);
			expect(pending[0].projectName).toBe("test-project");
			expect(pending[0].pipelineName).toBe("standard-sdlc");
		});

		it("populates phaseCompletedName and phaseNextName from pipeline definition", async () => {
			const pending = await service.listPendingGates();
			const gate = pending.find((g) => g.pipelineName === "standard-sdlc");
			expect(gate?.phaseCompletedName).toBe("Requirements");
			expect(gate?.phaseNextName).toBe("Architecture");
		});
	});

	describe("getGate()", () => {
		it("returns a gate by ID", async () => {
			const gate = await service.getGate(gateId);
			expect(gate).not.toBeNull();
			expect(gate?.id).toBe(gateId);
		});

		it("returns null for unknown gate", async () => {
			const gate = await service.getGate("nonexistent");
			expect(gate).toBeNull();
		});
	});

	describe("getCostSummary()", () => {
		it("returns cost breakdown by pipeline, agent, and model", async () => {
			const cost = await service.getCostSummary();
			expect(cost.totalCostUsd).toBeGreaterThan(0);
			expect(cost.byPipeline.length).toBeGreaterThanOrEqual(1);
			expect(cost.byAgent.length).toBeGreaterThanOrEqual(1);
			expect(cost.byModel.length).toBeGreaterThanOrEqual(1);
		});

		it("sorts by cost descending", async () => {
			const cost = await service.getCostSummary();
			if (cost.byAgent.length > 1) {
				expect(cost.byAgent[0].cost).toBeGreaterThanOrEqual(
					cost.byAgent[1].cost,
				);
			}
		});
	});

	describe("getAuditLog()", () => {
		it("returns audit log entries", async () => {
			const log = await service.getAuditLog();
			expect(Array.isArray(log)).toBe(true);
		});

		it("filters by pipeline run ID", async () => {
			const log = await service.getAuditLog(pipelineId);
			expect(Array.isArray(log)).toBe(true);
		});
	});

	describe("listArtifacts()", () => {
		it("returns all artifacts across all pipelines", async () => {
			const artifacts = await service.listArtifacts();
			expect(Array.isArray(artifacts)).toBe(true);
			expect(artifacts.length).toBeGreaterThanOrEqual(1);
		});

		it("returns artifacts for a specific pipeline", async () => {
			const artifacts = await service.listArtifacts(pipelineId);
			expect(Array.isArray(artifacts)).toBe(true);
			expect(artifacts.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("getArtifactContent()", () => {
		it("returns parsed JSON content for a JSON artifact", async () => {
			const artifactPath = join(OUT_DIR, "frd.json");
			const result = service.getArtifactContent(artifactPath);
			expect(result).not.toBeNull();
			expect(result?.content).toMatchObject({ title: "FRD" });
		});

		it("returns null for nonexistent path", () => {
			const result = service.getArtifactContent("/nonexistent/path.json");
			expect(result).toBeNull();
		});

		it("returns raw content for non-JSON files", async () => {
			const txtPath = join(OUT_DIR, "readme.txt");
			writeFileSync(txtPath, "hello world");
			const result = service.getArtifactContent(txtPath);
			expect(result).not.toBeNull();
			expect(result?.content).toBe("hello world");
		});
	});
});

// --- Additional tests for uncovered branches ---

describe("DashboardResourceService — phase summary branches", () => {
	const TEST_DB2 = "/tmp/sdlc-resource-service-phase-test.db";
	const OUT_DIR2 = "/tmp/sdlc-resource-service-phase-out";
	let store2: SqliteStateStore;
	let service2: DashboardResourceService;

	beforeAll(async () => {
		if (existsSync(TEST_DB2)) rmSync(TEST_DB2);
		if (existsSync(OUT_DIR2))
			rmSync(OUT_DIR2, { recursive: true, force: true });
		mkdirSync(OUT_DIR2, { recursive: true });
		store2 = new SqliteStateStore(TEST_DB2);
		service2 = new DashboardResourceService(
			store2,
			makeDefStore({ "standard-sdlc": sdlcPipelineDef() }),
		);
	});

	afterAll(async () => {
		await store2.close();
		if (existsSync(TEST_DB2)) rmSync(TEST_DB2);
		if (existsSync(OUT_DIR2))
			rmSync(OUT_DIR2, { recursive: true, force: true });
	});

	it("marks phase as skipped when pipeline failed and phase > currentPhase", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "failed-proj",
			pipelineName: "standard-sdlc",
			status: "failed",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});
		// Phase 1 has a failed run
		await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "failed",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		// Phases 2-6 have no runs

		const detail = await service2.getPipeline(pipeline.id);
		const phase2 = detail?.phaseSummary.find((p) => p.phase === 2);
		expect(phase2?.status).toBe("skipped");

		const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
		expect(phase1?.status).toBe("failed");
	});

	it("marks phase as active when runs are pending or running", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "active-proj",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const detail = await service2.getPipeline(pipeline.id);
		const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
		expect(phase1?.status).toBe("active");
	});

	it("marks phase as completed when all runs succeeded and pipeline moved past it", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "completed-proj",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});
		await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});

		const detail = await service2.getPipeline(pipeline.id);
		const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
		expect(phase1?.status).toBe("completed");
	});

	it("marks phase as revision-requested when gate has revision_requested status", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "revision-proj",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});
		await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
		});
		await store2.createGate({
			pipelineRunId: pipeline.id,
			phaseCompleted: 1,
			phaseNext: 2,
			status: "revision_requested",
			artifactVersionIds: [],
		});

		const detail = await service2.getPipeline(pipeline.id);
		const phase1 = detail?.phaseSummary.find((p) => p.phase === 1);
		expect(phase1?.status).toBe("revision-requested");
	});

	it("covers getConversationLogMtime for running agent runs", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "running-proj",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		// Should not throw, even with no artifacts
		const detail = await service2.getPipeline(pipeline.id);
		expect(detail).not.toBeNull();
	});

	it("returns empty conversation when run has no outputArtifactIds", async () => {
		const pipeline = await store2.createPipelineRun({
			projectName: "no-artifact-proj",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const run = await store2.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const conv = await service2.getRunConversation(run.id);
		expect(conv).toEqual([]);
	});
});

describe("DashboardResourceService — named pipeline phases", () => {
	const TEST_DB = "/tmp/sdlc-resource-service-named-phases.db";
	let store: SqliteStateStore;

	beforeAll(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterAll(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("uses custom pipeline phase names for a non-SDLC pipeline", async () => {
		const contentGen: PipelineDefinitionYaml = {
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "content-generation" },
			spec: {
				phases: [
					{ name: "research", phase: 1, agents: ["researcher"] },
					{ name: "outline", phase: 2, agents: ["outline-writer"] },
					{ name: "write", phase: 3, agents: ["writer"] },
				],
			},
		} as PipelineDefinitionYaml;
		const service = new DashboardResourceService(
			store,
			makeDefStore({ "content-generation": contentGen }),
		);
		const pipeline = await store.createPipelineRun({
			projectName: "blog-post",
			pipelineName: "content-generation",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});

		const detail = await service.getPipeline(pipeline.id);
		expect(detail?.phaseSummary.map((p) => p.name)).toEqual([
			"research",
			"outline",
			"write",
		]);
		// No SDLC labels should leak in
		expect(detail?.phaseSummary.some((p) => p.name === "Requirements")).toBe(
			false,
		);
	});

	it("falls back to data-derived phases when no pipeline definition exists", async () => {
		const service = new DashboardResourceService(store); // no defStore
		const pipeline = await store.createPipelineRun({
			projectName: "orphan",
			pipelineName: "unknown-pipeline",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});
		await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "mystery",
			phase: 2,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const detail = await service.getPipeline(pipeline.id);
		// Only phases present in runs/gates surface; no invented 1..6.
		expect(detail?.phaseSummary.map((p) => p.phase)).toEqual([2]);
		// Without a definition, no name is supplied — the UI will fall back to `Phase N`.
		expect(detail?.phaseSummary[0]?.name).toBeUndefined();
	});
});

describe("DashboardResourceService — readArtifact branches", () => {
	let service3: DashboardResourceService;
	let store3: SqliteStateStore;
	const TEST_DB3 = "/tmp/sdlc-resource-service-err-test.db";

	beforeAll(async () => {
		if (existsSync(TEST_DB3)) rmSync(TEST_DB3);
		store3 = new SqliteStateStore(TEST_DB3);
		service3 = new DashboardResourceService(store3);
	});

	afterAll(async () => {
		await store3.close();
		if (existsSync(TEST_DB3)) rmSync(TEST_DB3);
	});

	async function makeRun(artifactPaths: string[]) {
		const pipeline = await store3.createPipelineRun({
			projectName: "err-proj",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		return store3.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: artifactPaths,
			startedAt: new Date().toISOString(),
		});
	}

	it("returns '(file not found)' preview for non-existent artifact path", async () => {
		const run = await makeRun(["/nonexistent/missing-artifact.json"]);
		const artifacts = await service3.getRunArtifacts(run.id);
		expect(artifacts).not.toBeNull();
		expect(artifacts?.[0].preview).toBe("(file not found)");
	});

	it("returns raw text preview for non-JSON artifact file", async () => {
		const txtPath = join("/tmp", "sdlc-test-raw.txt");
		writeFileSync(txtPath, "hello world plain text");
		const run = await makeRun([txtPath]);
		const artifacts = await service3.getRunArtifacts(run.id);
		expect(artifacts).not.toBeNull();
		expect(artifacts?.[0].preview).toContain("hello world");
	});

	it("returns '(could not read file)' preview when readFileSync throws (directory path)", async () => {
		// A directory passes existsSync but readFileSync throws EISDIR
		const run = await makeRun(["/tmp"]);
		const artifacts = await service3.getRunArtifacts(run.id);
		expect(artifacts).not.toBeNull();
		expect(artifacts?.[0].preview).toBe("(could not read file)");
	});

	it("getArtifactContent returns null when readFileSync throws (directory path)", () => {
		// existsSync("/tmp") is true, but readFileSync("/tmp") throws
		const result = service3.getArtifactContent("/tmp");
		expect(result).toBeNull();
	});

	it("getConversationLogMtime returns mtime when conversation log exists", async () => {
		const artifactDir = "/tmp/sdlc-conv-mtime-test";
		mkdirSync(artifactDir, { recursive: true });
		const artifactPath = join(artifactDir, "frd.json");
		const logPath = join(artifactDir, "analyst-conversation.jsonl");
		writeFileSync(artifactPath, "{}");
		writeFileSync(logPath, JSON.stringify({ role: "user", content: "hi" }));

		// Create a running agent run so getConversationLogMtime is called
		const pipeline = await store3.createPipelineRun({
			projectName: "mtime-proj",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		await store3.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [artifactPath],
			startedAt: new Date().toISOString(),
		});

		// getPipeline calls getConversationLogMtime for running/pending runs
		const detail = await service3.getPipeline(pipeline.id);
		expect(detail).not.toBeNull();
		// The enriched run should have lastActivityAt set from conversation log mtime
		const enriched = detail?.runs.find((r) => r.agentName === "analyst");
		expect(enriched).toBeDefined();
	});

	it("loadConversation returns empty array on invalid JSONL content", async () => {
		const artifactDir = "/tmp/sdlc-conv-bad-test";
		mkdirSync(artifactDir, { recursive: true });
		const artifactPath = join(artifactDir, "frd.json");
		const logPath = join(artifactDir, "analyst-conversation.jsonl");
		writeFileSync(artifactPath, "{}");
		writeFileSync(logPath, "not-valid-json\nnot-valid-either");

		const run = await makeRun([artifactPath]);
		const conversation = await service3.getRunConversation(run.id);
		// With invalid JSON, loadConversation catches error and returns []
		expect(conversation).toEqual([]);
	});
});
