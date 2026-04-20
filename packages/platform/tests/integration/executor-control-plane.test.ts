import { existsSync, rmSync } from "node:fs";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import { GateController } from "agentforge-core/control-plane/gate-controller.js";
import { PipelineController } from "agentforge-core/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "agentforge-core/control-plane/scheduler.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "agentforge-core/domain/ports/agent-executor.port.js";
import type { PipelineEvent } from "agentforge-core/domain/ports/event-bus.port.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeHealthMonitor } from "../../src/control-plane/node-health-monitor.js";
import { ReconciliationLoop } from "../../src/control-plane/reconciler.js";

const TEST_DB = "/tmp/sdlc-integration-test.db";

function makeSuccessResult(): AgentJobResult {
	return {
		status: "succeeded",
		artifacts: [{ type: "spec", path: "frd.json", content: '{"title":"FRD"}' }],
		savedFiles: ["/output/frd.json"],
		tokenUsage: { inputTokens: 5000, outputTokens: 8000 },
		costUsd: 0.135,
		durationMs: 3000,
		conversationLog: [],
	};
}

describe("Executor / Control Plane Integration (P18-T7)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;
	let _controller: PipelineController;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		eventBus = new InMemoryEventBus();
		const gateCtrl = new GateController(store);
		const scheduler = new LocalAgentScheduler();
		_controller = new PipelineController(store, gateCtrl, scheduler);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("full flow: schedule → execute via executor → status streams → state updated", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		const statusUpdates: StatusUpdate[] = [];
		const executor: IAgentExecutor = {
			execute: async (job, onStatus) => {
				onStatus?.({
					type: "started",
					runId: job.runId,
					timestamp: Date.now(),
				});
				onStatus?.({
					type: "progress",
					runId: job.runId,
					message: "Working...",
					timestamp: Date.now(),
				});
				onStatus?.({
					type: "completed",
					runId: job.runId,
					timestamp: Date.now(),
				});
				return makeSuccessResult();
			},
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		// Start pipeline
		const pipeline = await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			inputs: { brief: "Build a todo app" },
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "pending",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		// Execute via executor
		const job: AgentJob = {
			runId: agentRun.id,
			agentId: "analyst",
			agentDefinition: {
				metadata: { name: "analyst" },
				spec: { executor: "pi-ai" },
			},
			inputs: [
				{ type: "other", path: "brief.txt", content: "Build a todo app" },
			],
			workdir: "/tmp/work",
			outputDir: "/tmp/out",
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4",
				maxTokens: 64000,
			},
		};

		const result = await executor.execute(job, (u) => {
			statusUpdates.push(u);
			store.updateAgentRun(agentRun.id, {
				lastStatusAt: new Date(u.timestamp).toISOString(),
				statusMessage: u.message,
			});
		});

		// Verify result
		expect(result.status).toBe("succeeded");
		expect(statusUpdates).toHaveLength(3);
		expect(statusUpdates[0].type).toBe("started");
		expect(statusUpdates[2].type).toBe("completed");

		// Update state from result
		await store.updateAgentRun(agentRun.id, {
			status: "succeeded",
			durationMs: result.durationMs,
			tokenUsage: result.tokenUsage,
			outputArtifactIds: [...result.savedFiles],
			costUsd: result.costUsd,
			completedAt: new Date().toISOString(),
		});

		const updatedRun = await store.getAgentRun(agentRun.id);
		expect(updatedRun?.status).toBe("succeeded");
		expect(updatedRun?.costUsd).toBe(0.135);
		expect(updatedRun?.lastStatusAt).toBeTruthy();
	});

	it("reconciler detects stale runs and fails them", async () => {
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
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		await store.updateAgentRun(agentRun.id, {
			lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
		});

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		const result = await reconciler.reconcile();

		expect(result.staleRunsDetected).toBe(1);
		expect((await store.getAgentRun(agentRun.id))?.status).toBe("failed");
	});

	it("node health monitor detects offline node and fails runs", async () => {
		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: ["llm-access"],
			status: "online",
			activeRuns: 1,
			lastHeartbeat: new Date(Date.now() - 150_000).toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "developer",
			phase: 1,
			nodeName: "gpu-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		expect((await store.getNode("gpu-1"))?.status).toBe("offline");
		expect((await store.getAgentRun(agentRun.id))?.status).toBe("failed");
		expect((await store.getAgentRun(agentRun.id))?.error).toContain(
			"node offline",
		);
	});

	it("pipeline inputs round-trip through create and retrieve", async () => {
		const inputs = {
			brief: "Build a SaaS platform",
			constraints: "Use PostgreSQL",
		};
		const run = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			inputs,
			startedAt: new Date().toISOString(),
		});

		const fetched = await store.getPipelineRun(run.id);
		expect(fetched?.inputs).toEqual(inputs);
	});

	it("event bus delivers to SSE subscribers", () => {
		const received: PipelineEvent[] = [];
		eventBus.subscribe((e) => received.push(e));

		eventBus.emit({
			type: "pipeline_updated",
			pipelineRunId: "r-1",
			status: "completed",
		});
		eventBus.emit({ type: "gate_opened", gateId: "g-1", pipelineRunId: "r-1" });
		eventBus.emit({ type: "node_offline", nodeName: "gpu-1" });

		expect(received).toHaveLength(3);
	});

	it("execution logs write and retrieve", async () => {
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
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "info",
			message: "Agent started",
			timestamp: new Date().toISOString(),
		});

		const logs = await store.listExecutionLogs(agentRun.id);
		expect(logs).toHaveLength(1);
		expect(logs[0].message).toBe("Agent started");
	});

	it("optimistic concurrency: version increments on updates", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		expect(pipeline.version).toBe(1);

		await store.updatePipelineRun(pipeline.id, { status: "paused_at_gate" });
		expect((await store.getPipelineRun(pipeline.id))?.version).toBe(2);

		await store.updatePipelineRun(pipeline.id, { status: "running" });
		expect((await store.getPipelineRun(pipeline.id))?.version).toBe(3);
	});
});
