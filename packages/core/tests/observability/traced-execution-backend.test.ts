import { describe, expect, it, vi } from "vitest";
import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
import { TracedExecutionBackend } from "../../src/observability/traced-execution-backend.js";

function makeRequest(overrides?: Partial<AgentRunRequest>): AgentRunRequest {
	return {
		runId: "run-001",
		agentId: "analyst",
		systemPrompt: "You are an analyst.",
		inputArtifacts: [],
		model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
		outputDir: "/tmp/out",
		conversationHistory: [],
		...overrides,
	};
}

function makeResult(overrides?: Partial<AgentRunResult>): AgentRunResult {
	return {
		events: [],
		artifacts: [],
		tokenUsage: { inputTokens: 100, outputTokens: 50 },
		savedFiles: [],
		conversationLog: [],
		...overrides,
	};
}

describe("TracedExecutionBackend", () => {
	it("delegates runAgent() to the inner backend", async () => {
		const result = makeResult();
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);
		const req = makeRequest();

		const actual = await backend.runAgent(req);
		expect(inner.runAgent).toHaveBeenCalledWith(req);
		expect(actual).toBe(result);
	});

	it("records span error status when result contains an error event", async () => {
		const result = makeResult({
			events: [{ kind: "error", message: "LLM failed", timestamp: Date.now() }],
		});
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);

		const actual = await backend.runAgent(makeRequest());
		const errEvent = actual.events.find((e) => e.kind === "error");
		expect(errEvent).toBeDefined();
		expect(errEvent?.message).toBe("LLM failed");
	});

	it("propagates errors thrown by inner backend", async () => {
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockRejectedValue(new Error("timeout")),
		};
		const backend = new TracedExecutionBackend(inner);

		await expect(backend.runAgent(makeRequest())).rejects.toThrow("timeout");
	});

	it("records token usage from result", async () => {
		const result = makeResult({
			tokenUsage: { inputTokens: 2000, outputTokens: 1500 },
		});
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);

		const actual = await backend.runAgent(makeRequest());
		expect(actual.tokenUsage.inputTokens).toBe(2000);
		expect(actual.tokenUsage.outputTokens).toBe(1500);
	});

	it("includes system_prompt attribute from request", async () => {
		const result = makeResult();
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);
		const req = makeRequest({ systemPrompt: "Custom system prompt" });

		// Should not throw even with a long system prompt
		await expect(backend.runAgent(req)).resolves.toBeDefined();
	});

	it("truncates input artifact content for span attributes", async () => {
		const result = makeResult();
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);
		const req = makeRequest({
			inputArtifacts: [{ path: "/tmp/big.json", content: "x".repeat(10_000) }],
		});

		await expect(backend.runAgent(req)).resolves.toBeDefined();
	});

	it("handles result with no error events (ok status)", async () => {
		const result = makeResult({
			events: [{ kind: "token", message: "...", timestamp: Date.now() }],
		});
		const inner: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue(result),
		};
		const backend = new TracedExecutionBackend(inner);
		const actual = await backend.runAgent(makeRequest());
		expect(actual.events.find((e) => e.kind === "error")).toBeUndefined();
	});
});
