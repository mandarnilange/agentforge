import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationEntry } from "../../src/domain/ports/execution-backend.port.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

describe("IStateStore conversation log methods", () => {
	let store: IStateStore;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		// Create a pipeline run + agent run to reference
		await store.createPipelineRun({
			projectName: "test-project",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const runs = await store.listPipelineRuns();
		await store.createAgentRun({
			pipelineRunId: runs[0].id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
	});

	afterEach(async () => {
		await store.close();
	});

	async function getRunId(): Promise<string> {
		const pipelines = await store.listPipelineRuns();
		const runs = await store.listAgentRuns(pipelines[0].id);
		return runs[0].id;
	}

	it("returns empty array when no conversation log exists", async () => {
		const runId = await getRunId();
		const log = await store.getConversationLog(runId);
		expect(log).toEqual([]);
	});

	it("saves and retrieves a conversation log", async () => {
		const runId = await getRunId();
		const entries: ConversationEntry[] = [
			{ role: "user", content: "Build a todo app", timestamp: 1000 },
			{
				role: "assistant",
				content: "I will create a todo app with React.",
				timestamp: 2000,
			},
			{
				role: "tool_call",
				content: '{"command": "mkdir src"}',
				name: "bash",
				timestamp: 3000,
			},
			{ role: "tool_result", content: "OK", name: "bash", timestamp: 4000 },
		];

		await store.saveConversationLog(runId, entries);
		const retrieved = await store.getConversationLog(runId);

		expect(retrieved).toHaveLength(4);
		expect(retrieved[0].role).toBe("user");
		expect(retrieved[0].content).toBe("Build a todo app");
		expect(retrieved[1].role).toBe("assistant");
		expect(retrieved[2].role).toBe("tool_call");
		expect(retrieved[2].name).toBe("bash");
		expect(retrieved[3].role).toBe("tool_result");
	});

	it("overwrites an existing conversation log on re-save", async () => {
		const runId = await getRunId();

		await store.saveConversationLog(runId, [
			{ role: "user", content: "first", timestamp: 1000 },
		]);
		await store.saveConversationLog(runId, [
			{ role: "user", content: "second", timestamp: 2000 },
		]);

		const log = await store.getConversationLog(runId);
		expect(log).toHaveLength(1);
		expect(log[0].content).toBe("second");
	});

	it("stores empty conversation log", async () => {
		const runId = await getRunId();
		await store.saveConversationLog(runId, []);
		const log = await store.getConversationLog(runId);
		expect(log).toEqual([]);
	});
});
