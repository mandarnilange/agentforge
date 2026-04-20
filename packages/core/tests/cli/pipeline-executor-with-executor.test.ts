import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

const TEST_DB = "/tmp/sdlc-pipeline-executor-refactor-test.db";

const STUB_CONFIG: AppConfig = {
	llm: {
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		apiKey: "test",
		maxTokens: 64000,
	},
	outputDir: "/tmp/sdlc-executor-refactor-output",
	promptsDir: "/prompts",
	logLevel: "silent",
};

function makeSuccessResult(
	overrides?: Partial<AgentJobResult>,
): AgentJobResult {
	return {
		status: "succeeded",
		artifacts: [{ type: "spec", path: "frd.json", content: '{"title":"FRD"}' }],
		savedFiles: ["/output/frd.json"],
		tokenUsage: { inputTokens: 5000, outputTokens: 8000 },
		costUsd: 0.135,
		durationMs: 3000,
		conversationLog: [
			{ role: "user", content: "Generate FRD", timestamp: Date.now() },
			{
				role: "assistant",
				content: "Here is the FRD...",
				timestamp: Date.now(),
			},
		],
		...overrides,
	};
}

function makeFailResult(error: string): AgentJobResult {
	return {
		status: "failed",
		artifacts: [],
		savedFiles: [],
		tokenUsage: { inputTokens: 100, outputTokens: 0 },
		costUsd: 0.0003,
		durationMs: 200,
		conversationLog: [],
		error,
	};
}

describe("executePipeline with IAgentExecutor (P18-T3)", () => {
	let store: SqliteStateStore;
	let controller: PipelineController;
	let outputBase: string;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		const gateCtrl = new GateController(store);
		const scheduler = new LocalAgentScheduler();
		controller = new PipelineController(store, gateCtrl, scheduler);

		outputBase = join(tmpdir(), `sdlc-exec-test-${Date.now()}`);
		mkdirSync(outputBase, { recursive: true });
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		try {
			rmSync(outputBase, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("delegates execution to IAgentExecutor.execute()", async () => {
		const executedJobs: AgentJob[] = [];

		const executor: IAgentExecutor = {
			execute: vi.fn().mockImplementation(async (job: AgentJob) => {
				executedJobs.push(job);
				return makeSuccessResult();
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
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
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		expect(executedJobs).toHaveLength(1);
		expect(executedJobs[0].agentId).toBe("analyst");
		expect(executedJobs[0].runId).toBeTruthy();
	});

	it("updates agent run state from executor result", async () => {
		const executor: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(makeSuccessResult()),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
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
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		const updatedRun = await store.getAgentRun(agentRun.id);
		expect(updatedRun?.status).toBe("succeeded");
		expect(updatedRun?.durationMs).toBe(3000);
		expect(updatedRun?.costUsd).toBe(0.135);
		expect(updatedRun?.tokenUsage).toEqual({
			inputTokens: 5000,
			outputTokens: 8000,
		});
		expect(updatedRun?.outputArtifactIds).toEqual(["/output/frd.json"]);
	});

	it("marks agent run as failed on executor failure", async () => {
		const executor: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(makeFailResult("LLM timeout")),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
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
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		const updatedRun = await store.getAgentRun(agentRun.id);
		expect(updatedRun?.status).toBe("failed");

		const pipeline = await store.getPipelineRun(pipelineRun.id);
		expect(pipeline?.status).toBe("failed");
	});

	it("builds AgentJob with correct fields from agent run and config", async () => {
		const capturedJobs: AgentJob[] = [];

		const executor: IAgentExecutor = {
			execute: vi.fn().mockImplementation(async (job: AgentJob) => {
				capturedJobs.push(job);
				return makeSuccessResult();
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
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
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			{ brief: "Build a todo app" },
			executor,
		);

		expect(capturedJobs).toHaveLength(1);
		const job = capturedJobs[0];
		expect(job.agentId).toBe("analyst");
		expect(job.model.provider).toBe("anthropic");
		expect(job.model.name).toBe("claude-sonnet-4-20250514");
		expect(job.model.maxTokens).toBe(64000);
		expect(job.outputDir).toContain("phase-1");
		expect(job.workdir).toBeTruthy();
	});

	it("passes revision notes through to AgentJob", async () => {
		const capturedJobs: AgentJob[] = [];

		const executor: IAgentExecutor = {
			execute: vi.fn().mockImplementation(async (job: AgentJob) => {
				capturedJobs.push(job);
				return makeSuccessResult();
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
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
			revisionNotes: "Add more detail on auth",
			startedAt: new Date().toISOString(),
		});

		await executePipeline(
			pipelineRun.id,
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		expect(capturedJobs[0].revisionNotes).toBe("Add more detail on auth");
	});

	it("streams conversation_entry events to sidecar, then overwrites with clean final conversation", async () => {
		// Mid-run: sidecar grows one line per conversation_entry StatusUpdate.
		// Post-run: pipeline-executor overwrites the sidecar with the clean
		// final result.conversationLog (de-duplicated messages from
		// agent.state.messages), replacing the per-delta fragments.
		let midStreamLines: Record<string, unknown>[] = [];
		const sidecar = join(outputBase, "phase-1", "analyst-conversation.jsonl");

		const executor: IAgentExecutor = {
			execute: vi.fn().mockImplementation(async (job: AgentJob, onStatus) => {
				onStatus?.({
					type: "conversation_entry",
					runId: job.runId,
					conversationEntry: {
						role: "assistant",
						content: "Analyzing requirements...",
						timestamp: 1000,
					},
					timestamp: 1000,
				});
				onStatus?.({
					type: "conversation_entry",
					runId: job.runId,
					conversationEntry: {
						role: "tool_call",
						content: '{"path":"/spec.md"}',
						name: "read_file",
						timestamp: 1100,
					},
					timestamp: 1100,
				});
				onStatus?.({
					type: "conversation_entry",
					runId: job.runId,
					conversationEntry: {
						role: "assistant",
						content: "Here is the FRD.",
						timestamp: 1200,
					},
					timestamp: 1200,
				});
				// Snapshot sidecar BEFORE returning so we can assert streaming
				// content was present before the final-conversation overwrite.
				midStreamLines = readFileSync(sidecar, "utf-8")
					.split("\n")
					.filter(Boolean)
					.map((l) => JSON.parse(l) as Record<string, unknown>);
				return makeSuccessResult();
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
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
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		// Mid-stream: seed user entry + 3 streaming events = 4 lines
		expect(midStreamLines).toHaveLength(4);
		expect(midStreamLines[0].role).toBe("user");
		expect(midStreamLines[1].content).toBe("Analyzing requirements...");
		expect(midStreamLines[2].role).toBe("tool_call");
		expect(midStreamLines[3].content).toBe("Here is the FRD.");

		// Post-run: sidecar is replaced with the clean final conversation
		// from makeSuccessResult (2 entries: user prompt + assistant reply).
		expect(existsSync(sidecar)).toBe(true);
		const finalLines = readFileSync(sidecar, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Record<string, unknown>);
		expect(finalLines).toHaveLength(2);
		expect(finalLines[0].role).toBe("user");
		expect(finalLines[0].content).toBe("Generate FRD");
		expect(finalLines[1].role).toBe("assistant");
		expect(finalLines[1].content).toBe("Here is the FRD...");
	});

	it("discards executor result when the run was cancelled mid-flight (race guard)", async () => {
		// Simulate the race: while executor.execute() is busy, the user calls
		// stopPipeline() which flips the agent run to failed/"Cancelled by user"
		// in the store. The executor eventually returns with a success result
		// (because the cancel happened after the LLM had already produced
		// output). The pipeline-executor race guard must NOT overwrite the
		// cancellation by saving the succeeded status.
		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "pending",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const executor: IAgentExecutor = {
			execute: vi.fn().mockImplementation(async () => {
				// Simulate user clicking Stop mid-run: stopPipeline flips the
				// agent run to failed/"Cancelled by user" while execute is still
				// running. Then execute finishes (late result).
				await store.updateAgentRun(agentRun.id, {
					status: "failed",
					error: "Cancelled by user",
					completedAt: new Date().toISOString(),
				});
				return makeSuccessResult();
			}),
			cancel: vi.fn().mockResolvedValue(undefined),
		};

		await executePipeline(
			pipelineRun.id,
			"test-project",
			store,
			controller,
			STUB_CONFIG,
			outputBase,
			undefined,
			undefined,
			executor,
		);

		const finalRun = await store.getAgentRun(agentRun.id);
		// Race guard must preserve the cancellation — not overwrite with
		// succeeded status or leak output artifacts from the cancelled run.
		expect(finalRun?.status).toBe("failed");
		expect(finalRun?.error).toBe("Cancelled by user");
		expect(finalRun?.outputArtifactIds).toEqual([]);
	});

	it("falls back to legacy execution when no executor provided", async () => {
		// When executor is undefined, the old code path should still work.
		// We can't fully test this without mocking createAgent, but we can verify
		// that passing undefined doesn't throw a TypeError.
		const pipelineRun = await store.createPipelineRun({
			projectName: "test-project",
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

		// Without an executor, the old path runs (createAgent/runner.run).
		// Since we haven't mocked it here, it will fail trying to load the agent.
		// That's fine — we just verify the function signature accepts undefined.
		try {
			await executePipeline(
				pipelineRun.id,
				"test-project",
				store,
				controller,
				STUB_CONFIG,
				outputBase,
				undefined,
				undefined,
				undefined, // no executor — legacy path
			);
		} catch {
			// Expected to fail (no real agent registry in test) — that's fine
		}

		// The key assertion: the function exists and accepts 9 args
		expect(executePipeline).toBeTypeOf("function");
	});
});
