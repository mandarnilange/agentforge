/**
 * Tests for the get-pipeline CLI command action callbacks.
 * Uses mocked IStateStore to test the display logic.
 */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerGetCommand } from "../../src/cli/commands/get-pipeline.js";
import type { AgentRunRecord } from "../../src/domain/models/agent-run.model.js";
import type { Gate } from "../../src/domain/models/gate.model.js";
import type { PipelineRun } from "../../src/domain/models/pipeline-run.model.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";

function makeMockStore(overrides?: Partial<IStateStore>): IStateStore {
	const pipeline: PipelineRun = {
		id: "pipe-001",
		sessionName: "peaceful-river",
		projectName: "my-project",
		pipelineName: "standard-sdlc",
		status: "paused_at_gate",
		currentPhase: 2,
		version: 1,
		startedAt: "2024-01-01T00:00:00Z",
		createdAt: "2024-01-01T00:00:00Z",
	};
	const agentRun: AgentRunRecord = {
		id: "run-001",
		pipelineRunId: "pipe-001",
		agentName: "analyst",
		phase: 1,
		nodeName: "local",
		status: "succeeded",
		inputArtifactIds: [],
		outputArtifactIds: [],
		provider: "anthropic",
		modelName: "claude-sonnet",
		startedAt: "2024-01-01T00:00:00Z",
		createdAt: "2024-01-01T00:00:00Z",
	};
	const gate: Gate = {
		id: "gate-001",
		pipelineRunId: "pipe-001",
		phaseCompleted: 1,
		phaseNext: 2,
		status: "pending",
		artifactVersionIds: [],
		createdAt: "2024-01-01T00:00:00Z",
	};

	return {
		listPipelineRuns: vi.fn().mockResolvedValue([pipeline]),
		getPipelineRun: vi.fn().mockResolvedValue(pipeline),
		updatePipelineRun: vi.fn().mockResolvedValue(undefined),
		createPipelineRun: vi.fn().mockResolvedValue(pipeline),
		createAgentRun: vi.fn().mockResolvedValue(agentRun),
		getAgentRun: vi.fn().mockResolvedValue(agentRun),
		updateAgentRun: vi.fn().mockResolvedValue(undefined),
		listAgentRuns: vi.fn().mockResolvedValue([agentRun]),
		createGate: vi.fn().mockResolvedValue(gate),
		getGate: vi.fn().mockResolvedValue(gate),
		updateGate: vi.fn().mockResolvedValue(undefined),
		listGates: vi.fn().mockResolvedValue([gate]),
		getPendingGate: vi.fn().mockResolvedValue(gate),
		upsertNode: vi.fn().mockResolvedValue(undefined),
		getNode: vi.fn().mockResolvedValue(null),
		listNodes: vi.fn().mockResolvedValue([]),
		writeAuditLog: vi.fn().mockResolvedValue(undefined),
		listAuditLog: vi.fn().mockResolvedValue([]),
		appendExecutionLog: vi.fn().mockResolvedValue(undefined),
		getExecutionLog: vi.fn().mockResolvedValue(null),
		appendConversationLog: vi.fn().mockResolvedValue(undefined),
		getConversationLog: vi.fn().mockResolvedValue([]),
		writePipelineInputs: vi.fn().mockResolvedValue(undefined),
		getPipelineInputs: vi.fn().mockResolvedValue(null),
		close: vi.fn(),
		...overrides,
	} as unknown as IStateStore;
}

async function runCommand(
	store: IStateStore,
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
	registerGetCommand(program, store);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// ignore commander exit
	} finally {
		console.log = origLog;
		console.error = origError;
	}

	return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

describe("get command actions", () => {
	describe("get pipelines", () => {
		it("lists pipeline runs", async () => {
			const store = makeMockStore();
			const { stdout } = await runCommand(store, ["get", "pipelines"]);
			expect(store.listPipelineRuns).toHaveBeenCalled();
			expect(stdout).toContain("pipe-001");
		});

		it("shows message when no pipelines", async () => {
			const store = makeMockStore({
				listPipelineRuns: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runCommand(store, ["get", "pipelines"]);
			expect(stdout).toContain("No pipeline runs");
		});
	});

	describe("get pipeline <id>", () => {
		it("prints pipeline detail", async () => {
			const store = makeMockStore();
			const { stdout } = await runCommand(store, [
				"get",
				"pipeline",
				"pipe-001",
			]);
			expect(store.getPipelineRun).toHaveBeenCalledWith("pipe-001");
			expect(stdout).toContain("pipe-001");
		});

		it("shows error for unknown pipeline", async () => {
			const store = makeMockStore({
				getPipelineRun: vi.fn().mockResolvedValue(null),
			});
			const mockExit = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const { stderr } = await runCommand(store, [
				"get",
				"pipeline",
				"unknown",
			]);
			expect(stderr).toContain("not found");
			mockExit.mockRestore();
		});

		it("shows completedAt when present", async () => {
			const store = makeMockStore({
				getPipelineRun: vi.fn().mockResolvedValue({
					id: "pipe-001",
					sessionName: "s",
					projectName: "p",
					pipelineName: "q",
					status: "completed",
					currentPhase: 6,
					version: 1,
					startedAt: "2024-01-01T00:00:00Z",
					completedAt: "2024-01-02T00:00:00Z",
					createdAt: "2024-01-01T00:00:00Z",
				}),
			});
			const { stdout } = await runCommand(store, [
				"get",
				"pipeline",
				"pipe-001",
			]);
			expect(stdout).toContain("2024-01-02");
		});
	});

	describe("get gates", () => {
		it("requires --pipeline option", async () => {
			const store = makeMockStore();
			const mockExit = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const { stderr } = await runCommand(store, ["get", "gates"]);
			expect(stderr).toContain("--pipeline");
			mockExit.mockRestore();
		});

		it("lists gates for a pipeline", async () => {
			const store = makeMockStore();
			const { stdout } = await runCommand(store, [
				"get",
				"gates",
				"--pipeline",
				"pipe-001",
			]);
			expect(store.listGates).toHaveBeenCalledWith("pipe-001");
			expect(stdout).toContain("gate-001");
		});

		it("shows message when no gates", async () => {
			const store = makeMockStore({
				listGates: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runCommand(store, [
				"get",
				"gates",
				"--pipeline",
				"pipe-001",
			]);
			expect(stdout).toContain("No gates");
		});
	});

	describe("get gate <id>", () => {
		it("shows gate detail", async () => {
			const store = makeMockStore();
			const { stdout } = await runCommand(store, ["get", "gate", "gate-001"]);
			expect(store.getGate).toHaveBeenCalledWith("gate-001");
			expect(stdout).toContain("gate-001");
		});

		it("shows error for unknown gate", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue(null),
			});
			const mockExit = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const { stderr } = await runCommand(store, ["get", "gate", "unknown"]);
			expect(stderr).toContain("not found");
			mockExit.mockRestore();
		});

		it("shows reviewer, comment, revisionNotes, decidedAt when present", async () => {
			const store = makeMockStore({
				getGate: vi.fn().mockResolvedValue({
					id: "gate-001",
					pipelineRunId: "pipe-001",
					phaseCompleted: 1,
					phaseNext: 2,
					status: "approved",
					artifactVersionIds: [],
					createdAt: "2024-01-01T00:00:00Z",
					reviewer: "alice",
					comment: "Looks good",
					revisionNotes: "Fix X",
					decidedAt: "2024-01-02T00:00:00Z",
				}),
			});
			const { stdout } = await runCommand(store, ["get", "gate", "gate-001"]);
			expect(stdout).toContain("alice");
			expect(stdout).toContain("Looks good");
			expect(stdout).toContain("Fix X");
		});
	});

	describe("get runs", () => {
		it("requires --pipeline option", async () => {
			const store = makeMockStore();
			const mockExit = vi
				.spyOn(process, "exit")
				.mockImplementation(() => undefined as never);
			const { stderr } = await runCommand(store, ["get", "runs"]);
			expect(stderr).toContain("--pipeline");
			mockExit.mockRestore();
		});

		it("lists agent runs for a pipeline", async () => {
			const store = makeMockStore();
			const { stdout } = await runCommand(store, [
				"get",
				"runs",
				"--pipeline",
				"pipe-001",
			]);
			expect(store.listAgentRuns).toHaveBeenCalledWith("pipe-001");
			expect(stdout).toContain("run-001");
		});

		it("shows message when no runs", async () => {
			const store = makeMockStore({
				listAgentRuns: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runCommand(store, [
				"get",
				"runs",
				"--pipeline",
				"pipe-001",
			]);
			expect(stdout).toContain("No agent runs");
		});
	});
});
