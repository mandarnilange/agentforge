import { describe, expect, it, vi } from "vitest";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
} from "../../src/domain/ports/agent-executor.port.js";
import { TracedAgentExecutor } from "../../src/observability/traced-agent-executor.js";

function makeJob(overrides?: Partial<AgentJob>): AgentJob {
	return {
		runId: "run-123",
		agentId: "analyst",
		systemPrompt: "You are a business analyst.",
		inputArtifacts: [],
		model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
		outputDir: "/tmp/out",
		...overrides,
	};
}

function makeResult(overrides?: Partial<AgentJobResult>): AgentJobResult {
	return {
		status: "completed",
		artifacts: [],
		events: [],
		tokenUsage: { inputTokens: 100, outputTokens: 200 },
		costUsd: 0.0012,
		savedFiles: [],
		durationMs: 500,
		...overrides,
	};
}

describe("TracedAgentExecutor", () => {
	it("delegates execute() to the inner executor", async () => {
		const result = makeResult();
		const inner: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(result),
		};
		const executor = new TracedAgentExecutor(inner);
		const job = makeJob();

		const actual = await executor.execute(job);
		expect(inner.execute).toHaveBeenCalledWith(job, undefined);
		expect(actual).toBe(result);
	});

	it("passes onStatus callback to inner executor", async () => {
		const result = makeResult();
		const inner: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(result),
		};
		const executor = new TracedAgentExecutor(inner);
		const onStatus = vi.fn();

		await executor.execute(makeJob(), onStatus);
		expect(inner.execute).toHaveBeenCalledWith(expect.anything(), onStatus);
	});

	it("propagates result when status is failed", async () => {
		const failedResult = makeResult({ status: "failed", error: "LLM timeout" });
		const inner: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(failedResult),
		};
		const executor = new TracedAgentExecutor(inner);

		const actual = await executor.execute(makeJob());
		expect(actual.status).toBe("failed");
		expect(actual.error).toBe("LLM timeout");
	});

	it("propagates errors thrown by inner executor", async () => {
		const inner: IAgentExecutor = {
			execute: vi.fn().mockRejectedValue(new Error("network error")),
		};
		const executor = new TracedAgentExecutor(inner);

		await expect(executor.execute(makeJob())).rejects.toThrow("network error");
	});

	it("forwards cancel() to the inner executor", async () => {
		const inner: IAgentExecutor = {
			execute: vi.fn(),
			cancel: vi.fn().mockResolvedValue(undefined),
		};
		const executor = new TracedAgentExecutor(inner);
		await executor.cancel("run-abc");
		expect(inner.cancel).toHaveBeenCalledWith("run-abc");
	});

	it("records artifact count attribute on success", async () => {
		const result = makeResult({
			artifacts: [
				{ path: "/out/a.json", type: "json" },
				{ path: "/out/b.json", type: "json" },
			],
		});
		const inner: IAgentExecutor = {
			execute: vi.fn().mockResolvedValue(result),
		};
		const executor = new TracedAgentExecutor(inner);
		const actual = await executor.execute(makeJob());
		expect(actual.artifacts).toHaveLength(2);
	});
});
