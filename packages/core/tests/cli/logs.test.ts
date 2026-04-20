import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerLogsCommand } from "../../src/cli/commands/logs.js";
import type { ConversationEntry } from "../../src/domain/ports/execution-backend.port.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

describe("logs command registration", () => {
	it("should register a 'logs' command with run-id argument", () => {
		const program = new Command();
		const store = new SqliteStateStore(":memory:");
		registerLogsCommand(program, store);

		const logsCmd = program.commands.find((c) => c.name() === "logs");
		expect(logsCmd).toBeDefined();
		store.close();
	});

	it("should accept --conversation flag", () => {
		const program = new Command();
		const store = new SqliteStateStore(":memory:");
		registerLogsCommand(program, store);

		const logsCmd = program.commands.find((c) => c.name() === "logs");
		const convOption = logsCmd?.options.find(
			(o) => o.long === "--conversation",
		);
		expect(convOption).toBeDefined();
		store.close();
	});
});

describe("logs --conversation reads from store", () => {
	let store: IStateStore;
	let runId: string;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "completed",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		runId = agentRun.id;
	});

	afterEach(async () => {
		await store.close();
		vi.restoreAllMocks();
	});

	it("displays conversation from store when available", async () => {
		const entries: ConversationEntry[] = [
			{ role: "user", content: "Build a todo app", timestamp: 1000 },
			{ role: "assistant", content: "Creating todo app.", timestamp: 2000 },
		];
		await store.saveConversationLog(runId, entries);

		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.join(" "));
		});

		const program = new Command();
		registerLogsCommand(program, store);
		await program.parseAsync(["node", "test", "logs", runId, "--conversation"]);

		const output = logs.join("\n");
		expect(output).toContain("USER");
		expect(output).toContain("Build a todo app");
		expect(output).toContain("ASSISTANT");
		expect(output).toContain("Creating todo app.");
	});
});
