/**
 * Tests for the logs CLI command action callbacks.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerLogsCommand } from "../../src/cli/commands/logs.js";
import type { AgentRunRecord } from "../../src/domain/models/agent-run.model.js";
import type { PipelineRun } from "../../src/domain/models/pipeline-run.model.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";

const TEST_OUT = "/tmp/sdlc-logs-actions-test";

const agentRun: AgentRunRecord = {
	id: "run-001",
	pipelineRunId: "pipe-001",
	agentName: "analyst",
	phase: 1,
	nodeName: "local",
	status: "succeeded",
	inputArtifactIds: [],
	outputArtifactIds: [join(TEST_OUT, "frd.json")],
	provider: "anthropic",
	modelName: "claude-sonnet-4-20250514",
	costUsd: 0.015,
	tokenUsage: { inputTokens: 1000, outputTokens: 800 },
	startedAt: "2024-01-01T00:00:00Z",
	completedAt: "2024-01-01T01:00:00Z",
	durationMs: 3600000,
	createdAt: "2024-01-01T00:00:00Z",
};

const pipeline: PipelineRun = {
	id: "pipe-001",
	sessionName: "peaceful-river",
	projectName: "test-project",
	pipelineName: "standard-sdlc",
	status: "running",
	currentPhase: 2,
	version: 1,
	startedAt: "2024-01-01T00:00:00Z",
	createdAt: "2024-01-01T00:00:00Z",
};

beforeAll(() => {
	mkdirSync(TEST_OUT, { recursive: true });
	writeFileSync(join(TEST_OUT, "frd.json"), JSON.stringify({ title: "FRD" }));
	writeFileSync(
		join(TEST_OUT, "analyst-conversation.jsonl"),
		[
			JSON.stringify({ role: "user", content: "Hello" }),
			JSON.stringify({ role: "assistant", content: "World" }),
			JSON.stringify({
				role: "tool_call",
				content: "search()",
				name: "search",
			}),
			JSON.stringify({ role: "tool_result", content: "results..." }),
		].join("\n"),
	);
});

afterAll(() => {
	rmSync(TEST_OUT, { recursive: true, force: true });
});

function makeMockStore(overrides?: Partial<IStateStore>): IStateStore {
	return {
		getAgentRun: vi.fn().mockResolvedValue(agentRun),
		getPipelineRun: vi.fn().mockResolvedValue(null),
		listAgentRuns: vi.fn().mockResolvedValue([agentRun]),
		getConversationLog: vi.fn().mockResolvedValue([]),
		listPipelineRuns: vi.fn().mockResolvedValue([]),
		createPipelineRun: vi.fn(),
		updatePipelineRun: vi.fn(),
		createAgentRun: vi.fn(),
		updateAgentRun: vi.fn(),
		createGate: vi.fn(),
		getGate: vi.fn(),
		updateGate: vi.fn(),
		listGates: vi.fn(),
		getPendingGate: vi.fn(),
		upsertNode: vi.fn(),
		getNode: vi.fn(),
		listNodes: vi.fn(),
		writeAuditLog: vi.fn(),
		listAuditLog: vi.fn(),
		appendExecutionLog: vi.fn(),
		getExecutionLog: vi.fn(),
		appendConversationLog: vi.fn(),
		writePipelineInputs: vi.fn(),
		getPipelineInputs: vi.fn(),
		close: vi.fn(),
		...overrides,
	} as unknown as IStateStore;
}

async function runLogsCommand(
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
	registerLogsCommand(program, store);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// ignore
	} finally {
		console.log = origLog;
		console.error = origError;
	}

	return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

describe("logs command actions", () => {
	describe("logs <run-id> (basic)", () => {
		it("shows run details for an agent run", async () => {
			const store = makeMockStore();
			const { stdout } = await runLogsCommand(store, ["logs", "run-001"]);
			expect(stdout).toContain("analyst");
			expect(stdout).toContain("succeeded");
			expect(stdout).toContain("anthropic");
			expect(stdout).toContain("claude-sonnet");
		});

		it("shows token usage and cost", async () => {
			const store = makeMockStore();
			const { stdout } = await runLogsCommand(store, ["logs", "run-001"]);
			expect(stdout).toContain("1000");
			expect(stdout).toContain("800");
			expect(stdout).toContain("0.015000");
		});

		it("shows completedAt and duration when present", async () => {
			const store = makeMockStore();
			const { stdout } = await runLogsCommand(store, ["logs", "run-001"]);
			expect(stdout).toContain("2024-01-01T01:00:00Z");
			expect(stdout).toContain("Duration");
		});

		it("shows error when run has error field", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue({
					...agentRun,
					error: "LLM timeout",
					status: "failed",
				}),
			});
			const { stdout } = await runLogsCommand(store, ["logs", "run-001"]);
			expect(stdout).toContain("LLM timeout");
		});

		it("shows output artifacts", async () => {
			const store = makeMockStore();
			const { stdout } = await runLogsCommand(store, ["logs", "run-001"]);
			expect(stdout).toContain("frd.json");
		});
	});

	describe("logs <run-id> --conversation", () => {
		it("shows conversation from JSONL sidecar file", async () => {
			const store = makeMockStore({
				getConversationLog: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runLogsCommand(store, [
				"logs",
				"run-001",
				"--conversation",
			]);
			expect(stdout).toContain("USER");
			expect(stdout).toContain("ASSISTANT");
			expect(stdout).toContain("Hello");
		});

		it("shows tool_call and tool_result entries", async () => {
			const store = makeMockStore({
				getConversationLog: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runLogsCommand(store, [
				"logs",
				"run-001",
				"--conversation",
			]);
			expect(stdout).toContain("TOOL CALL");
			expect(stdout).toContain("TOOL RESULT");
		});

		it("uses conversation from store when available", async () => {
			const store = makeMockStore({
				getConversationLog: vi
					.fn()
					.mockResolvedValue([
						{ role: "user", content: "store-message", timestamp: Date.now() },
					]),
			});
			const { stdout } = await runLogsCommand(store, [
				"logs",
				"run-001",
				"--conversation",
			]);
			expect(stdout).toContain("store-message");
		});

		it("shows no conversation found message when no log exists", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue({
					...agentRun,
					outputArtifactIds: [],
				}),
				getConversationLog: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runLogsCommand(store, [
				"logs",
				"run-001",
				"--conversation",
			]);
			expect(stdout).toContain("No conversation log");
		});

		it("shows revision notes when present", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue({
					...agentRun,
					revisionNotes: "Please improve section 2",
				}),
				getConversationLog: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runLogsCommand(store, [
				"logs",
				"run-001",
				"--conversation",
			]);
			expect(stdout).toContain("Please improve section 2");
		});
	});

	describe("logs with pipeline run ID", () => {
		it("shows pipeline summary when given pipeline ID", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue(null),
				getPipelineRun: vi.fn().mockResolvedValue(pipeline),
				listAgentRuns: vi.fn().mockResolvedValue([agentRun]),
			});
			const { stdout } = await runLogsCommand(store, ["logs", "pipe-001"]);
			expect(stdout).toContain("test-project");
			expect(stdout).toContain("standard-sdlc");
		});

		it("shows empty message when pipeline has no runs", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue(null),
				getPipelineRun: vi.fn().mockResolvedValue(pipeline),
				listAgentRuns: vi.fn().mockResolvedValue([]),
			});
			const { stdout } = await runLogsCommand(store, ["logs", "pipe-001"]);
			expect(stdout).toContain("no agent runs");
		});
	});

	describe("logs with unknown ID", () => {
		it("shows error when ID not found", async () => {
			const store = makeMockStore({
				getAgentRun: vi.fn().mockResolvedValue(null),
				getPipelineRun: vi.fn().mockResolvedValue(null),
			});
			const { stderr } = await runLogsCommand(store, ["logs", "unknown-id"]);
			expect(stderr).toContain("No agent run or pipeline run found");
		});
	});
});
