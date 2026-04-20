import { describe, expect, it } from "vitest";
import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
import { executeLlmStep } from "../../src/engine/steps/llm-step.js";

describe("executeLlmStep error handling", () => {
	const request: AgentRunRequest = {
		agentId: "developer",
		systemPrompt: "test",
		inputArtifacts: [],
		model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 8192 },
	};

	it("returns failed status when backend returns error events", async () => {
		const backend: IExecutionBackend = {
			async runAgent(): Promise<AgentRunResult> {
				return {
					artifacts: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					durationMs: 100,
					events: [
						{
							kind: "error",
							timestamp: Date.now(),
							message: "API credit balance too low",
						},
					],
				};
			},
		};

		const result = await executeLlmStep(
			{ name: "generate-backend", type: "llm" },
			backend,
			request,
		);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("API credit balance too low");
		expect(result.artifacts).toHaveLength(0);
	});

	it("returns success when backend returns artifacts without errors", async () => {
		const backend: IExecutionBackend = {
			async runAgent(): Promise<AgentRunResult> {
				return {
					artifacts: [{ type: "api-code", path: "api.ts", content: "code" }],
					tokenUsage: { inputTokens: 100, outputTokens: 200 },
					durationMs: 500,
					events: [],
				};
			},
		};

		const result = await executeLlmStep(
			{ name: "generate-backend", type: "llm" },
			backend,
			request,
		);

		expect(result.status).toBe("success");
		expect(result.artifacts).toHaveLength(1);
	});

	it("returns failed status when backend throws", async () => {
		const backend: IExecutionBackend = {
			async runAgent(): Promise<AgentRunResult> {
				throw new Error("Network timeout");
			},
		};

		const result = await executeLlmStep(
			{ name: "generate-backend", type: "llm" },
			backend,
			request,
		);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("Network timeout");
	});
});
