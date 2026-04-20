/**
 * Tests for the run-pipeline CLI command — start and continue paths.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockExistsSync,
	mockReadFileSync,
	mockLoadConfig,
	mockExecutePipeline,
	mockParsePipelineDef,
	mockCreateAgentExecutor,
	mockOra,
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
	mockCreateAgentExecutor: vi.fn().mockReturnValue({}),
	mockOra: vi.fn().mockReturnValue({
		start: vi.fn().mockReturnThis(),
		succeed: vi.fn().mockReturnThis(),
		fail: vi.fn().mockReturnThis(),
	}),
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

vi.mock("../../src/di/executor-factory.js", () => ({
	createAgentExecutor: mockCreateAgentExecutor,
}));

vi.mock("ora", () => ({
	default: mockOra,
}));

import { registerRunPipelineCommand } from "../../src/cli/commands/run-pipeline.js";
import type { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";

function makePipeline(overrides = {}) {
	return {
		id: "pipe-1",
		sessionName: "test-session",
		projectName: "my-project",
		pipelineName: "standard-sdlc",
		status: "running" as const,
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
		startPipeline: vi.fn().mockResolvedValue(makePipeline()),
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
	registerRunPipelineCommand(program, controller, store);

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

describe("run command", () => {
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
		mockCreateAgentExecutor.mockReturnValue({});
		mockOra.mockReturnValue({
			start: vi.fn().mockReturnThis(),
			succeed: vi.fn().mockReturnThis(),
			fail: vi.fn().mockReturnThis(),
		});
		mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit called");
		});
	});

	afterEach(() => {
		mockExit.mockRestore();
	});

	describe("config loading", () => {
		it("exits with error when API key is missing", async () => {
			mockLoadConfig.mockImplementation(() => {
				throw new Error("API key missing");
			});
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("Failed to load configuration");
		});

		it("exits with error when createAgentExecutor throws", async () => {
			mockCreateAgentExecutor.mockImplementation(() => {
				throw new Error("executor init failed");
			});
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("executor init failed");
		});
	});

	describe("--continue flag", () => {
		it("exits when run ID not found", async () => {
			const store = makeMockStore({
				getPipelineRun: vi.fn().mockResolvedValue(null),
			});
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"run",
				"--continue",
				"nonexistent",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("shows waiting message when pending gate exists", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValue(makePipeline({ status: "paused_at_gate" })),
				getPendingGate: vi.fn().mockResolvedValue({
					id: "gate-1",
					phaseCompleted: 1,
					phaseNext: 2,
					status: "pending",
				}),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--continue",
				"pipe-1",
			]);
			expect(stdout).toContain("waiting at gate");
		});

		it("exits when pipeline definition not found on disk for continue", async () => {
			mockExistsSync.mockReturnValue(false);
			const store = makeMockStore({
				getPipelineRun: vi.fn().mockResolvedValue(makePipeline()),
				getPendingGate: vi.fn().mockResolvedValue(null),
			});
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"run",
				"--continue",
				"pipe-1",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("resumes pipeline and shows run details", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(makePipeline({ status: "completed" })),
				getPendingGate: vi.fn().mockResolvedValue(null),
				listAgentRuns: vi.fn().mockResolvedValue([]),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--continue",
				"pipe-1",
			]);
			expect(stdout).toContain("pipe-1");
			expect(stdout).toContain("my-project");
		});

		it("shows gate info when pipeline pauses at gate after resume", async () => {
			mockExecutePipeline.mockResolvedValue({
				pausedAtGate: true,
				gateId: "gate-2",
				phaseCompleted: 2,
				phaseNext: 3,
			});
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline({ status: "paused_at_gate" }))
					.mockResolvedValueOnce(makePipeline({ status: "running" })),
				getPendingGate: vi.fn().mockResolvedValue(null),
				listAgentRuns: vi.fn().mockResolvedValue([]),
				updatePipelineRun: vi.fn().mockResolvedValue(undefined),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--continue",
				"pipe-1",
			]);
			expect(stdout).toContain("paused at gate");
		});

		it("updates status to running when pipeline was paused_at_gate", async () => {
			const updatePipelineRun = vi.fn().mockResolvedValue(undefined);
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline({ status: "paused_at_gate" }))
					.mockResolvedValueOnce(makePipeline()),
				getPendingGate: vi.fn().mockResolvedValue(null),
				listAgentRuns: vi.fn().mockResolvedValue([]),
				updatePipelineRun,
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, ["run", "--continue", "pipe-1"]);
			expect(updatePipelineRun).toHaveBeenCalledWith("pipe-1", {
				status: "running",
			});
		});

		it("schedules phase when no active runs for current phase", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(makePipeline()),
				getPendingGate: vi.fn().mockResolvedValue(null),
				listAgentRuns: vi.fn().mockResolvedValue([]),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, ["run", "--continue", "pipe-1"]);
			expect(ctrl.schedulePhasePublic).toHaveBeenCalled();
		});

		it("does not reschedule when active runs exist for current phase (covers filter/some callbacks)", async () => {
			// Provide a run with matching phase and active status so filter/some callbacks run
			const activeRun = {
				id: "ar-1",
				pipelineRunId: "pipe-1",
				agentName: "analyst",
				phase: 1, // matches existingRun.currentPhase = 1
				nodeName: "local",
				status: "running" as const,
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
				createdAt: new Date().toISOString(),
				retryCount: 0,
			};
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce(makePipeline())
					.mockResolvedValueOnce(makePipeline()),
				getPendingGate: vi.fn().mockResolvedValue(null),
				listAgentRuns: vi.fn().mockResolvedValue([activeRun]),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, ["run", "--continue", "pipe-1"]);
			// hasActiveRuns is true, so schedulePhasePublic should NOT be called
			expect(ctrl.schedulePhasePublic).not.toHaveBeenCalled();
		});
	});

	describe("new pipeline run", () => {
		it("exits when --project is not provided", async () => {
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, ["run"]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("--project is required");
		});

		it("exits when pipeline definition not found on disk", async () => {
			mockExistsSync.mockReturnValue(false);
			const store = makeMockStore();
			const ctrl = makeMockController();
			const { stderr } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(stderr).toContain("not found");
		});

		it("starts pipeline and shows run ID and project", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValue(makePipeline({ status: "completed" })),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(stdout).toContain("pipe-1");
			expect(stdout).toContain("my-project");
		});

		it("shows gate pause info when pipeline pauses at a gate", async () => {
			mockExecutePipeline.mockResolvedValue({
				pausedAtGate: true,
				gateId: "gate-1",
				phaseCompleted: 1,
				phaseNext: 2,
			});
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValue(makePipeline({ status: "paused_at_gate" })),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(stdout).toContain("paused at gate");
			expect(stdout).toContain("gate-1");
		});

		it("shows check-status hint when pipeline completes without gate", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValue(makePipeline({ status: "completed" })),
			});
			const ctrl = makeMockController();
			const { stdout } = await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
			]);
			expect(stdout).toContain("get pipeline");
		});

		it("exits with error when startPipeline throws", async () => {
			const store = makeMockStore();
			const ctrl = makeMockController({
				startPipeline: vi
					.fn()
					.mockRejectedValue(new Error("startPipeline failed")),
			});
			await runCommand(store, ctrl, ["run", "--project", "my-project"]);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("parses --input key=value pairs", async () => {
			const store = makeMockStore({
				getPipelineRun: vi
					.fn()
					.mockResolvedValue(makePipeline({ status: "completed" })),
			});
			const ctrl = makeMockController();
			await runCommand(store, ctrl, [
				"run",
				"--project",
				"my-project",
				"--input",
				"prompt=Build a todo app",
			]);
			expect(ctrl.startPipeline).toHaveBeenCalledWith(
				"my-project",
				expect.anything(),
				expect.objectContaining({ prompt: "Build a todo app" }),
			);
		});
	});
});
