/**
 * Integration tests for the pipeline execution loop (P9.5-T6).
 * Tests: phase sequencing, gate pausing, parallel execution, artifact chaining.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executePipeline } from "../../src/cli/pipeline-executor.js";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import type { PipelineDefinitionYaml } from "../../src/definitions/parser.js";
import type { AppConfig } from "../../src/di/config.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
} from "../../src/domain/ports/agent-executor.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-execution-loop-test.db";

const MOCK_CONFIG: AppConfig = {
	llm: { provider: "anthropic", model: "claude-3-haiku", maxTokens: 4096 },
	outputDir: "/tmp/sdlc-test-output",
	logLevel: "silent",
};

// Minimal 2-phase sequential pipeline with gates
const SEQ_PIPELINE: PipelineDefinitionYaml = {
	apiVersion: "agentforge/v1",
	kind: "PipelineDefinition",
	metadata: { name: "seq-test", displayName: "Sequential Test" },
	spec: {
		phases: [
			{
				name: "phase1",
				phase: 1,
				agents: ["analyst"],
				gate: { required: true },
			},
			{
				name: "phase2",
				phase: 2,
				agents: ["architect"],
				gate: { required: true },
			},
		],
	},
};

// Phase 4-style pipeline: one phase with parallel=true and 3 agents
const PAR_PIPELINE: PipelineDefinitionYaml = {
	apiVersion: "agentforge/v1",
	kind: "PipelineDefinition",
	metadata: { name: "par-test", displayName: "Parallel Test" },
	spec: {
		phases: [
			{
				name: "impl",
				phase: 1,
				parallel: true,
				agents: ["agent-a", "agent-b", "agent-c"],
				gate: { required: true },
			},
		],
	},
};

// ---- mocks ----

/**
 * Shared spy for execute() invocations — lets tests inspect the AgentJob args
 * without reaching into executor internals. Tests can override the mock
 * implementation (e.g. for parallel/sequential timing) and still use this
 * for call-site assertions.
 */
const mockExecuteFn = vi.fn(
	async (_job: AgentJob): Promise<AgentJobResult> => ({
		status: "succeeded",
		artifacts: [],
		savedFiles: [],
		tokenUsage: { inputTokens: 5, outputTokens: 10 },
		costUsd: 0.01,
		durationMs: 50,
		conversationLog: [],
	}),
);

function makeMockExecutor(): IAgentExecutor {
	return {
		execute: mockExecuteFn,
		cancel: vi.fn().mockResolvedValue(undefined),
	};
}

vi.mock("../../src/agents/registry.js", () => ({
	getAgentInfo: vi.fn((id: string) => ({
		id,
		displayName: id,
		executor: "pi-ai",
	})),
}));

// Suppress ora spinner output in tests
vi.mock("ora", () => ({
	default: vi.fn(() => ({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
	})),
}));

// ---- helpers ----

function makeDeps() {
	const store = new SqliteStateStore(TEST_DB);
	const gateCtrl = new GateController(store);
	const scheduler = new LocalAgentScheduler();
	const controller = new PipelineController(store, gateCtrl, scheduler);
	return { store, gateCtrl, controller };
}

describe("executePipeline — execution loop", () => {
	let store: SqliteStateStore;
	let controller: PipelineController;
	let executor: IAgentExecutor;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		const deps = makeDeps();
		store = deps.store;
		controller = deps.controller;
		mockExecuteFn.mockClear();
		// Reset to the default success implementation for each test; tests that
		// need custom behavior override via mockExecuteFn.mockImplementation().
		mockExecuteFn.mockImplementation(
			async (_job: AgentJob): Promise<AgentJobResult> => ({
				status: "succeeded",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 5, outputTokens: 10 },
				costUsd: 0.01,
				durationMs: 50,
				conversationLog: [],
			}),
		);
		executor = makeMockExecutor();
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	// --- gate pausing ---

	it("pauses at gate after phase 1 completes", async () => {
		const run = await controller.startPipeline("p", SEQ_PIPELINE, {});
		const result = await executePipeline(
			run.id,
			"p",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		expect(result.pausedAtGate).toBe(true);
		expect(result.gateId).toBeDefined();
		expect(result.phaseCompleted).toBe(1);
		expect(result.phaseNext).toBe(2);
	});

	it("pipeline status is paused_at_gate after execution stops", async () => {
		const run = await controller.startPipeline("p", SEQ_PIPELINE, {});
		await executePipeline(
			run.id,
			"p",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		const pipeline = await store.getPipelineRun(run.id);
		expect(pipeline?.status).toBe("paused_at_gate");
	});

	// --- artifact chaining ---

	it("passes no input to phase-1 agents", async () => {
		const run = await controller.startPipeline("proj", SEQ_PIPELINE, {});
		await executePipeline(
			run.id,
			"proj",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		// Phase 1 agent should receive no input artifacts
		const firstCall = mockExecuteFn.mock.calls[0][0];
		expect(firstCall.inputs).toEqual([]);
	});

	it("passes phase-1 output dir as input to phase-2 agents", async () => {
		const run = await controller.startPipeline("proj", SEQ_PIPELINE, {});

		// Phase 1 runs → pauses at gate
		await executePipeline(
			run.id,
			"proj",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		// Approve gate to advance to phase 2
		const gate = await store.getPendingGate(run.id);
		if (!gate) throw new Error("Expected pending gate");
		await controller.approveGate(gate.id, SEQ_PIPELINE);

		// Execute phase 2
		await executePipeline(
			run.id,
			"proj",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		// Phase 2 agent call should receive prior phase output dir as an input
		// artifact. pipeline-executor packs it as ArtifactData with the dir path
		// in the content field.
		const secondCall = mockExecuteFn.mock.calls[1][0];
		expect(secondCall.inputs).toHaveLength(1);
		expect(secondCall.inputs[0].content).toEqual(join("/tmp/out", "phase-1"));
	});

	// --- parallel execution ---

	it("runs agents concurrently for parallel phases", async () => {
		const startOrder: string[] = [];
		const resolvers: Array<() => void> = [];

		// Mock: each agent run records its start, then waits to be manually resolved
		mockExecuteFn.mockImplementation(
			() =>
				new Promise<AgentJobResult>((resolve) => {
					startOrder.push("started");
					resolvers.push(() =>
						resolve({
							status: "succeeded",
							artifacts: [],
							savedFiles: [],
							tokenUsage: { inputTokens: 0, outputTokens: 0 },
							costUsd: 0,
							durationMs: 0,
							conversationLog: [],
						}),
					);
				}),
		);

		const run = await controller.startPipeline("p", PAR_PIPELINE, {});
		const execPromise = executePipeline(
			run.id,
			"p",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			PAR_PIPELINE,
			undefined,
			executor,
		);

		// Let microtasks run so all parallel agents can start
		// Need extra ticks because store methods are now async
		for (let i = 0; i < 20; i++) await Promise.resolve();

		// All 3 agents should have started before any resolved
		expect(startOrder).toHaveLength(3);

		// Now resolve all
		for (const r of resolvers) r();
		await execPromise;
	});

	it("runs agents sequentially for non-parallel phases", async () => {
		const callOrder: number[] = [];
		let callIndex = 0;

		mockExecuteFn.mockImplementation(async () => {
			callOrder.push(callIndex++);
			return {
				status: "succeeded",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				costUsd: 0,
				durationMs: 0,
				conversationLog: [],
			};
		});

		const run = await controller.startPipeline("p", SEQ_PIPELINE, {});
		await executePipeline(
			run.id,
			"p",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			SEQ_PIPELINE,
			undefined,
			executor,
		);

		// Only phase 1 agent runs (pauses at gate). Sequential means 1 call.
		expect(callOrder).toHaveLength(1);
		expect(mockExecuteFn).toHaveBeenCalledTimes(1);
	});

	// --- phase sequencing ---

	it("completes pipeline after all phases approved", async () => {
		const NO_GATE_PIPELINE: PipelineDefinitionYaml = {
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "no-gate", displayName: "No Gate" },
			spec: {
				phases: [
					{
						name: "p1",
						phase: 1,
						agents: ["analyst"],
						gate: { required: false },
					},
					{
						name: "p2",
						phase: 2,
						agents: ["architect"],
						gate: { required: false },
					},
				],
			},
		};

		const run = await controller.startPipeline("p", NO_GATE_PIPELINE, {});
		const result = await executePipeline(
			run.id,
			"p",
			store,
			controller,
			MOCK_CONFIG,
			"/tmp/out",
			NO_GATE_PIPELINE,
			undefined,
			executor,
		);

		expect(result.pausedAtGate).toBe(false);
		const pipeline = await store.getPipelineRun(run.id);
		expect(pipeline?.status).toBe("completed");
		expect(mockExecuteFn).toHaveBeenCalledTimes(2);
	});
});
