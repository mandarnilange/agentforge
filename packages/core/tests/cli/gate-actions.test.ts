/**
 * Tests for the gate CLI command — approve, reject, revise actions.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockExistsSync,
	mockReadFileSync,
	mockLoadConfig,
	mockExecutePipeline,
	mockParsePipelineDef,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn().mockReturnValue(true),
	mockReadFileSync: vi.fn().mockReturnValue("kind: PipelineDefinition"),
	mockLoadConfig: vi
		.fn()
		.mockReturnValue({ outputDir: "/tmp/output", anthropicApiKey: "test-key" }),
	mockExecutePipeline: vi.fn().mockResolvedValue({ pausedAtGate: false }),
	mockParsePipelineDef: vi
		.fn()
		.mockReturnValue({ kind: "PipelineDefinition", spec: { phases: [] } }),
}));

vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
}));

vi.mock("../../src/definitions/parser.js", () => ({
	parsePipelineDefinition: mockParsePipelineDef,
}));

vi.mock("../../src/di/config.js", () => ({
	loadConfig: mockLoadConfig,
}));

vi.mock("../../src/cli/pipeline-executor.js", () => ({
	executePipeline: mockExecutePipeline,
}));

import { registerGateCommand } from "../../src/cli/commands/gate.js";
import type { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";

function makeGate(overrides = {}) {
	return {
		id: "gate-1",
		pipelineRunId: "pipe-1",
		phaseCompleted: 1,
		phaseNext: 2,
		status: "pending",
		reviewer: null,
		comment: null,
		revisionNotes: null,
		artifactVersionIds: [],
		crossCuttingFindings: null,
		decidedAt: null,
		createdAt: "2024-01-01T00:00:00Z",
		version: 1,
		...overrides,
	};
}

function makePipeline(overrides = {}) {
	return {
		id: "pipe-1",
		sessionName: "test-session",
		projectName: "my-project",
		pipelineName: "standard-sdlc",
		status: "paused_at_gate" as const,
		currentPhase: 1,
		inputs: null,
		version: 1,
		startedAt: "2024-01-01T00:00:00Z",
		completedAt: null,
		createdAt: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function makeMockStore(overrides: Record<string, unknown> = {}): IStateStore {
	return {
		getGate: vi.fn().mockResolvedValue(null),
		getPipelineRun: vi.fn().mockResolvedValue(null),
		updatePipelineRun: vi.fn().mockResolvedValue(undefined),
		listAgentRuns: vi.fn().mockResolvedValue([]),
		getPendingGate: vi.fn().mockResolvedValue(null),
		createPipelineRun: vi.fn(),
		createAgentRun: vi.fn(),
		getAgentRun: vi.fn(),
		listPipelineRuns: vi.fn(),
		updateAgentRun: vi.fn(),
		createGate: vi.fn(),
		listGates: vi.fn(),
		updateGate: vi.fn(),
		upsertNode: vi.fn(),
		getNode: vi.fn(),
		listNodes: vi.fn(),
		writeAuditLog: vi.fn(),
		listAuditLog: vi.fn(),
		getConversationLog: vi.fn(),
		saveConversationLog: vi.fn(),
		writeExecutionLog: vi.fn(),
		listExecutionLogs: vi.fn(),
		close: vi.fn(),
		...overrides,
	} as unknown as IStateStore;
}

function makeMockController(
	overrides: Record<string, unknown> = {},
): PipelineController {
	return {
		approveGate: vi.fn().mockResolvedValue(undefined),
		rejectGate: vi.fn().mockResolvedValue(undefined),
		reviseGate: vi.fn().mockResolvedValue(undefined),
		startPipeline: vi.fn(),
		schedulePhasePublic: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as unknown as PipelineController;
}

async function runCommand(
	store: IStateStore,
	controller: PipelineController,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const logs: string[] = [];
	const errors: string[] = [];
	const origLog = console.log;
	const origError = console.error;
	console.log = (...a: unknown[]) => logs.push(a.join(" "));
	console.error = (...a: unknown[]) => errors.push(a.join(" "));

	const program = new Command();
	program.exitOverride();
	registerGateCommand(program, store, controller);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// ignore commander exits and mocked process.exit errors
	} finally {
		console.log = origLog;
		console.error = origError;
	}

	return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

describe("gate command", () => {
	let mockExit: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue("kind: PipelineDefinition");
		mockLoadConfig.mockReturnValue({
			outputDir: "/tmp/output",
			anthropicApiKey: "test-key",
		});
		mockExecutePipeline.mockResolvedValue({ pausedAtGate: false });
		mockParsePipelineDef.mockReturnValue({
			kind: "PipelineDefinition",
			spec: { phases: [] },
		});
		mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
	});

	afterEach(() => {
		mockExit.mockRestore();
	});

	describe("gate approve <id>", () => {
		it("exits with error when gate not found", async () => {
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("exits with error when gate is not pending", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate({ status: "approved" })),
			});
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not pending");
		});

		it("exits when pipeline run not found", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(null),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, ["gate", "approve", "gate-1"]);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("exits when pipeline definition not found on disk", async () => {
			mockExistsSync.mockReturnValue(false);
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("shows Gate approved and Pipeline completed when pipeline finishes", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(makePipeline({ status: "completed" })),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(stdout).toContain("Gate approved");
			expect(stdout).toContain("Pipeline completed");
		});

		it("shows advancing phase when pipeline is still running", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(
						makePipeline({ status: "running", currentPhase: 2 }),
					),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(stdout).toContain("Gate approved");
			expect(stdout).toContain("Advancing to phase");
		});

		it("warns when no API key configured and pipeline is running", async () => {
			mockLoadConfig.mockImplementation(() => {
				throw new Error("no API key");
			});
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(
						makePipeline({ status: "running", currentPhase: 2 }),
					),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(stdout).toContain("No API key");
		});

		it("shows paused gate info when pipeline pauses at next gate", async () => {
			mockExecutePipeline.mockResolvedValue({
				pausedAtGate: true,
				gateId: "gate-2",
				phaseCompleted: 2,
				phaseNext: 3,
			});
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(
						makePipeline({ status: "running", currentPhase: 2 }),
					),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(stdout).toContain("paused at next gate");
		});

		it("exits with error when controller throws", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController({
				approveGate: vi.fn().mockRejectedValue(new Error("DB error")),
			});
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("DB error");
		});

		it("passes reviewer and comment to controller", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(makePipeline({ status: "completed" })),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, [
				"gate",
				"approve",
				"gate-1",
				"--reviewer",
				"alice",
				"--comment",
				"LGTM",
			]);
			expect(ctrl.approveGate).toHaveBeenCalledWith(
				"gate-1",
				expect.anything(),
				"alice",
				"LGTM",
			);
		});
	});

	describe("gate reject <id>", () => {
		it("exits with error when gate not found", async () => {
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"reject",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("shows rejection message on success", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"reject",
				"gate-1",
			]);
			expect(stdout).toContain("rejected");
		});

		it("exits with error when controller throws", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
			});
			const ctrl = makeMockController({
				rejectGate: vi.fn().mockRejectedValue(new Error("reject failed")),
			});
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"reject",
				"gate-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("reject failed");
		});

		it("passes reviewer and comment to controller", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, [
				"gate",
				"reject",
				"gate-1",
				"--reviewer",
				"bob",
				"--comment",
				"NACK",
			]);
			expect(ctrl.rejectGate).toHaveBeenCalledWith("gate-1", "bob", "NACK");
		});
	});

	describe("gate revise <id>", () => {
		it("exits with error when gate not found", async () => {
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Please fix X",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("exits when pipeline run not found", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(null),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Fix it",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("shows revision requested message on success", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Please fix X",
			]);
			expect(stdout).toContain("Revision requested");
			expect(stdout).toContain("Please fix X");
		});

		it("warns when no API key during revision", async () => {
			mockLoadConfig.mockImplementation(() => {
				throw new Error("no API key");
			});
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Fix it",
			]);
			expect(stdout).toContain("No API key");
		});

		it("shows gate reopened info when revision pauses at next gate", async () => {
			mockExecutePipeline.mockResolvedValue({
				pausedAtGate: true,
				gateId: "gate-2",
				phaseCompleted: 1,
				phaseNext: 2,
			});
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Fix it",
			]);
			expect(stdout).toContain("Revision complete");
		});

		it("exits with error when controller throws", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController({
				reviseGate: vi.fn().mockRejectedValue(new Error("revise failed")),
			});
			const { stderr } = await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Fix it",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("revise failed");
		});

		it("passes notes and reviewer to controller", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(makeGate()),
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, [
				"gate",
				"revise",
				"gate-1",
				"--notes",
				"Fix the auth bug",
				"--reviewer",
				"carol",
			]);
			expect(ctrl.reviseGate).toHaveBeenCalledWith(
				"gate-1",
				"Fix the auth bug",
				"carol",
			);
		});
	});
});
