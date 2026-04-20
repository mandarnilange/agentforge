import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import type { PipelineDefinitionYaml } from "../../src/definitions/parser.js";
import type { IAgentExecutor } from "../../src/domain/ports/agent-executor.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-pipeline-test.db";

const MINI_PIPELINE: PipelineDefinitionYaml = {
	apiVersion: "agentforge/v1",
	kind: "PipelineDefinition",
	metadata: { name: "mini-pipeline", displayName: "Mini Test Pipeline" },
	spec: {
		phases: [
			{
				name: "requirements",
				phase: 1,
				agents: ["analyst"],
				gate: { required: true },
			},
			{
				name: "architecture",
				phase: 2,
				agents: ["architect"],
				gate: { required: true },
			},
		],
	},
};

describe("PipelineController", () => {
	let store: SqliteStateStore;
	let gateCtrl: GateController;
	let scheduler: LocalAgentScheduler;
	let controller: PipelineController;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		gateCtrl = new GateController(store);
		scheduler = new LocalAgentScheduler();
		controller = new PipelineController(store, gateCtrl, scheduler);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("starts a pipeline run at phase 1", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);
		expect(run.status).toBe("running");
		expect(run.currentPhase).toBe(1);
		expect(run.projectName).toBe("test-project");
		expect(run.pipelineName).toBe("mini-pipeline");
	});

	it("creates agent run record when pipeline starts", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);
		const agentRuns = await store.listAgentRuns(run.id);
		expect(agentRuns).toHaveLength(1);
		expect(agentRuns[0].agentName).toBe("analyst");
		expect(agentRuns[0].phase).toBe(1);
	});

	it("advances pipeline to next phase on agent completion and gate approval", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);

		// Simulate agent completing
		const agentRuns = await store.listAgentRuns(run.id);
		await controller.onAgentRunCompleted(agentRuns[0].id, []);

		// Pipeline should be paused at gate
		const paused = await store.getPipelineRun(run.id);
		expect(paused?.status).toBe("paused_at_gate");

		// Approve the gate via controller (which also schedules next phase)
		const pendingGate = await store.getPendingGate(run.id);
		expect(pendingGate).not.toBeNull();
		await controller.approveGate(pendingGate?.id, MINI_PIPELINE, "admin");

		// Pipeline should advance to phase 2
		const advanced = await store.getPipelineRun(run.id);
		expect(advanced?.currentPhase).toBe(2);
		expect(advanced?.status).toBe("running");

		// New agent run for phase 2 should exist
		const allRuns = await store.listAgentRuns(run.id);
		expect(allRuns).toHaveLength(2);
		expect(allRuns[1].agentName).toBe("architect");
		expect(allRuns[1].phase).toBe(2);
	});

	it("marks pipeline as completed after last phase gate approval", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);

		// Complete phase 1
		const runs1 = await store.listAgentRuns(run.id);
		await controller.onAgentRunCompleted(runs1[0].id, []);
		const gate1 = await store.getPendingGate(run.id);
		if (!gate1) throw new Error("Expected gate1 to exist");
		await controller.approveGate(gate1.id, MINI_PIPELINE);

		// Complete phase 2
		const runs2 = await store.listAgentRuns(run.id);
		const phase2Run = runs2.find((r) => r.phase === 2);
		if (!phase2Run) throw new Error("Expected phase2Run to exist");
		await controller.onAgentRunCompleted(phase2Run.id, []);
		const gate2 = await store.getPendingGate(run.id);
		if (!gate2) throw new Error("Expected gate2 to exist");
		await controller.approveGate(gate2.id, MINI_PIPELINE);

		const completed = await store.getPipelineRun(run.id);
		expect(completed?.status).toBe("completed");
	});

	it("marks agent run as failed when error occurs", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);
		const agentRuns = await store.listAgentRuns(run.id);
		await controller.onAgentRunFailed(agentRuns[0].id, "LLM API error");

		const failedRun = await store.getAgentRun(agentRuns[0].id);
		expect(failedRun?.status).toBe("failed");
		expect(failedRun?.error).toBe("LLM API error");

		const pipeline = await store.getPipelineRun(run.id);
		expect(pipeline?.status).toBe("failed");
	});

	it("schedules parallel agents for parallel phase", async () => {
		const parallelPipeline: PipelineDefinitionYaml = {
			...MINI_PIPELINE,
			spec: {
				phases: [
					{
						name: "implementation",
						phase: 1,
						parallel: true,
						agents: ["frontend", "developer", "dataengineer"],
						gate: { required: true, waitForAll: true },
					},
				],
			},
		};

		const run = await controller.startPipeline("test", parallelPipeline, {});
		const agentRuns = await store.listAgentRuns(run.id);
		expect(agentRuns).toHaveLength(3);
		const names = agentRuns.map((r) => r.agentName).sort();
		expect(names).toEqual(["dataengineer", "developer", "frontend"]);
	});

	it("waits for all parallel agents before opening gate", async () => {
		const parallelPipeline: PipelineDefinitionYaml = {
			...MINI_PIPELINE,
			spec: {
				phases: [
					{
						name: "implementation",
						phase: 1,
						parallel: true,
						agents: ["frontend", "developer"],
						gate: { required: true, waitForAll: true },
					},
				],
			},
		};

		const run = await controller.startPipeline("test", parallelPipeline, {});
		const agentRuns = await store.listAgentRuns(run.id);

		// Complete only first agent — gate should NOT open yet
		await controller.onAgentRunCompleted(agentRuns[0].id, []);
		expect(await store.getPendingGate(run.id)).toBeNull();
		expect((await store.getPipelineRun(run.id))?.status).toBe("running");

		// Complete second agent — gate should now open
		await controller.onAgentRunCompleted(agentRuns[1].id, []);
		expect(await store.getPendingGate(run.id)).not.toBeNull();
		expect((await store.getPipelineRun(run.id))?.status).toBe("paused_at_gate");
	});

	it("lists all pipeline runs", async () => {
		await controller.startPipeline("p1", MINI_PIPELINE, {});
		await controller.startPipeline("p2", MINI_PIPELINE, {});
		const runs = await controller.listPipelineRuns();
		expect(runs).toHaveLength(2);
	});

	it("revise re-schedules agents for the completed phase", async () => {
		const run = await controller.startPipeline(
			"test-project",
			MINI_PIPELINE,
			{},
		);

		// Complete phase 1 — opens gate
		const agentRuns = await store.listAgentRuns(run.id);
		await controller.onAgentRunCompleted(agentRuns[0].id, []);
		const gate = await store.getPendingGate(run.id);
		if (!gate) throw new Error("Expected gate to exist");

		// Request revision
		await controller.reviseGate(gate.id, "Add more detail", "reviewer1");

		// Pipeline should be running again at phase 1
		const pipeline = await store.getPipelineRun(run.id);
		expect(pipeline?.status).toBe("running");
		expect(pipeline?.currentPhase).toBe(1);

		// New agent run record created for phase 1
		const allRuns = await store.listAgentRuns(run.id);
		expect(allRuns.length).toBeGreaterThan(1);
		const phase1Runs = allRuns.filter((r) => r.phase === 1);
		expect(phase1Runs.length).toBe(2);
		const newRun = phase1Runs.find((r) => r.status === "pending");
		expect(newRun).toBeDefined();
		expect(newRun?.agentName).toBe("analyst");
	});

	describe("stopPipeline (P18-T17)", () => {
		it("calls executor.cancel() for running agent runs before updating DB state", async () => {
			const cancelSpy = vi.fn().mockResolvedValue(undefined);
			const executor: IAgentExecutor = {
				execute: vi.fn(),
				cancel: cancelSpy,
			};
			const ctrl = new PipelineController(
				store,
				gateCtrl,
				scheduler,
				undefined,
				executor,
			);

			const run = await ctrl.startPipeline("p", MINI_PIPELINE, {});
			// Mark the first agent run as running so stopPipeline calls cancel
			const agentRuns = await store.listAgentRuns(run.id);
			await store.updateAgentRun(agentRuns[0].id, { status: "running" });

			await ctrl.stopPipeline(run.id);

			expect(cancelSpy).toHaveBeenCalledWith(agentRuns[0].id);
			const updated = await store.getPipelineRun(run.id);
			expect(updated?.status).toBe("cancelled");
			const updatedAgentRun = await store.getAgentRun(agentRuns[0].id);
			expect(updatedAgentRun?.status).toBe("failed");
			expect(updatedAgentRun?.error).toBe("Cancelled by user");
		});

		it("still updates DB state when no executor is injected (legacy behavior)", async () => {
			// controller created in beforeEach without an executor
			const run = await controller.startPipeline("p", MINI_PIPELINE, {});
			const agentRuns = await store.listAgentRuns(run.id);
			await store.updateAgentRun(agentRuns[0].id, { status: "running" });

			await controller.stopPipeline(run.id);

			const updated = await store.getPipelineRun(run.id);
			expect(updated?.status).toBe("cancelled");
		});

		it("swallows executor.cancel() errors to guarantee DB cancellation", async () => {
			const executor: IAgentExecutor = {
				execute: vi.fn(),
				cancel: vi.fn().mockRejectedValue(new Error("executor unreachable")),
			};
			const ctrl = new PipelineController(
				store,
				gateCtrl,
				scheduler,
				undefined,
				executor,
			);

			const run = await ctrl.startPipeline("p", MINI_PIPELINE, {});
			const agentRuns = await store.listAgentRuns(run.id);
			await store.updateAgentRun(agentRuns[0].id, { status: "running" });

			await expect(ctrl.stopPipeline(run.id)).resolves.toBeDefined();
			const updated = await store.getPipelineRun(run.id);
			expect(updated?.status).toBe("cancelled");
		});
	});
});
