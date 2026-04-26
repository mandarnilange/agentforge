import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "gpt-4o",
		name: "gpt-4o",
		api: "openai-responses",
		provider: "openai",
	}),
	stream: vi.fn(),
}));

import { OpenAiExecutionBackend } from "../../../src/adapters/execution/openai-execution-backend.js";

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "analyst",
		systemPrompt: "You are a BA.",
		inputArtifacts: [],
		model: {
			provider: "openai",
			name: "gpt-4o",
			maxTokens: 8192,
		},
		...overrides,
	};
}

describe("OpenAiExecutionBackend", () => {
	const originalEnv = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.OPENAI_API_KEY = "test-key-123";
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.OPENAI_API_KEY = originalEnv;
		} else {
			delete process.env.OPENAI_API_KEY;
		}
	});

	it("should implement IExecutionBackend", () => {
		const backend = new OpenAiExecutionBackend();
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	it("should throw if OPENAI_API_KEY is not set", () => {
		delete process.env.OPENAI_API_KEY;
		expect(() => new OpenAiExecutionBackend()).toThrow("OPENAI_API_KEY");
	});

	it("should override request model provider to openai", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 100, outputTokens: 50 },
			durationMs: 500,
			events: [],
			conversationLog: [],
		} satisfies AgentRunResult);

		const backend = new OpenAiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		await backend.runAgent(
			makeRequest({
				model: { provider: "anything", name: "gpt-4o", maxTokens: 8192 },
			}),
		);

		const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
		expect(calledRequest.model.provider).toBe("openai");
	});

	it("should pass through abort signal to delegate", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 0,
			events: [],
		} satisfies AgentRunResult);

		const backend = new OpenAiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const controller = new AbortController();
		await backend.runAgent(makeRequest({ signal: controller.signal }));

		const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
		expect(calledRequest.signal).toBe(controller.signal);
	});

	it("should propagate errors from delegate backend", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 100,
			events: [
				{ kind: "error", timestamp: Date.now(), message: "Rate limited" },
			],
		} satisfies AgentRunResult);

		const backend = new OpenAiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const result = await backend.runAgent(makeRequest());
		expect(result.events[0].kind).toBe("error");
	});

	it("should preserve token usage from delegate", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: {
				inputTokens: 1000,
				outputTokens: 500,
				extras: [
					{ kind: "openai.reasoning", tokens: 200, costMultiplier: 1.0 },
				],
			},
			durationMs: 1000,
			events: [],
		} satisfies AgentRunResult);

		const backend = new OpenAiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const result = await backend.runAgent(makeRequest());
		expect(result.tokenUsage.inputTokens).toBe(1000);
		expect(result.tokenUsage.outputTokens).toBe(500);
	});
});
