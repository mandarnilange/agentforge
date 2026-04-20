import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-execution-logs-test.db";

describe("Execution logs persistence (P18-T5)", () => {
	let store: SqliteStateStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("writes and reads execution log entries", async () => {
		const pipelineRun = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "info",
			message: "Agent started",
			timestamp: new Date().toISOString(),
		});
		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "info",
			message: "Generating FRD...",
			metadata: { step: "llm" },
			timestamp: new Date().toISOString(),
		});
		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "error",
			message: "Token limit warning",
			timestamp: new Date().toISOString(),
		});

		const logs = await store.listExecutionLogs(agentRun.id);
		expect(logs).toHaveLength(3);
		expect(logs[0].level).toBe("info");
		expect(logs[0].message).toBe("Agent started");
		expect(logs[1].metadata).toEqual({ step: "llm" });
		expect(logs[2].level).toBe("error");
	});

	it("returns empty array for agent run with no logs", async () => {
		const pipelineRun = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const logs = await store.listExecutionLogs(agentRun.id);
		expect(logs).toEqual([]);
	});

	it("returns logs in chronological order", async () => {
		const pipelineRun = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipelineRun.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "info",
			message: "First",
			timestamp: "2026-04-08T10:00:00.000Z",
		});
		await store.writeExecutionLog({
			agentRunId: agentRun.id,
			level: "info",
			message: "Second",
			timestamp: "2026-04-08T10:00:01.000Z",
		});

		const logs = await store.listExecutionLogs(agentRun.id);
		expect(logs[0].message).toBe("First");
		expect(logs[1].message).toBe("Second");
	});
});
