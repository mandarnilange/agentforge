import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePipeline } from "../../src/cli/pipeline-executor.js";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import type { AppConfig } from "../../src/di/config.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
} from "../../src/domain/ports/agent-executor.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-pipeline-executor-test.db";

const STUB_CONFIG: AppConfig = {
	llm: { provider: "anthropic", model: "test", maxTokens: 1000 },
	outputDir: "/tmp/sdlc-executor-test-output",
	promptsDir: "/prompts",
	logLevel: "silent",
};

const OUTPUT_BASE = join("/tmp", "sdlc-executor-test-output", "my-project");

function makeExecutor(capturedJobs: AgentJob[]): IAgentExecutor {
	return {
		execute: vi.fn(async (job: AgentJob): Promise<AgentJobResult> => {
			capturedJobs.push(job);
			return {
				status: "succeeded",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				costUsd: 0,
				durationMs: 10,
				conversationLog: [],
			};
		}),
		cancel: vi.fn().mockResolvedValue(undefined),
	};
}

describe("executePipeline", () => {
	let store: SqliteStateStore;
	let controller: PipelineController;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		const gateCtrl = new GateController(store);
		const scheduler = new LocalAgentScheduler();
		controller = new PipelineController(store, gateCtrl, scheduler);
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("passes phase1Inputs to phase 1 agents", async () => {
		const capturedJobs: AgentJob[] = [];
		const executor = makeExecutor(capturedJobs);

		const pipelineRun = await store.createPipelineRun({
			projectName: "my-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "pending",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		await executePipeline(
			pipelineRun.id,
			"my-project",
			store,
			controller,
			STUB_CONFIG,
			OUTPUT_BASE,
			undefined,
			["/tmp/brief.md", "/tmp/notes.txt"],
			executor,
		);

		// buildInputArtifacts packs string[] inputs as ArtifactData[], one per entry
		expect(capturedJobs).toHaveLength(1);
		expect(capturedJobs[0].inputs).toHaveLength(2);
		expect(capturedJobs[0].inputs[0].content).toBe("/tmp/brief.md");
		expect(capturedJobs[0].inputs[1].content).toBe("/tmp/notes.txt");
	});

	it("initializes prevPhaseOutputDir from completed runs on cross-process resume", async () => {
		const capturedJobs: AgentJob[] = [];
		const executor = makeExecutor(capturedJobs);

		// Simulate a pipeline where phase 1 already completed (previous process)
		const pipelineRun = await store.createPipelineRun({
			projectName: "my-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 2,
			startedAt: new Date().toISOString(),
		});

		// Phase 1 agent run already succeeded
		const phase1Run = await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		await store.updateAgentRun(phase1Run.id, {
			status: "succeeded",
			completedAt: new Date().toISOString(),
		});

		// Phase 2 agent run is pending (scheduled after gate approval)
		await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "architect",
			phase: 2,
			nodeName: "local",
			status: "pending",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		await executePipeline(
			pipelineRun.id,
			"my-project",
			store,
			controller,
			STUB_CONFIG,
			OUTPUT_BASE,
			undefined,
			undefined,
			executor,
		);

		// Phase 2 should receive the phase-1 output dir as an input artifact
		expect(capturedJobs).toHaveLength(1);
		expect(capturedJobs[0].inputs).toHaveLength(1);
		expect(capturedJobs[0].inputs[0].content).toBe(
			join(OUTPUT_BASE, "phase-1"),
		);
	});
});
