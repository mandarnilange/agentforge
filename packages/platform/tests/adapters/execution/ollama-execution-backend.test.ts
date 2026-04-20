import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "llama3",
		name: "llama3",
		api: "openai-completions",
		provider: "openai",
	}),
	stream: vi.fn(),
}));

import { OllamaExecutionBackend } from "../../../src/adapters/execution/ollama-execution-backend.js";

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "analyst",
		systemPrompt: "You are a BA.",
		inputArtifacts: [],
		model: {
			provider: "ollama",
			name: "llama3",
			maxTokens: 4096,
		},
		...overrides,
	};
}

describe("OllamaExecutionBackend", () => {
	const originalBaseUrl = process.env.OLLAMA_BASE_URL;
	const originalApiKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.OLLAMA_BASE_URL;
		// Ollama doesn't require API key but the OpenAI-compatible layer might
		process.env.OPENAI_API_KEY = "ollama";
	});

	afterEach(() => {
		if (originalBaseUrl !== undefined) {
			process.env.OLLAMA_BASE_URL = originalBaseUrl;
		} else {
			delete process.env.OLLAMA_BASE_URL;
		}
		if (originalApiKey !== undefined) {
			process.env.OPENAI_API_KEY = originalApiKey;
		} else {
			delete process.env.OPENAI_API_KEY;
		}
	});

	it("should implement IExecutionBackend", () => {
		const backend = new OllamaExecutionBackend();
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	it("should NOT require an API key", () => {
		delete process.env.OPENAI_API_KEY;
		expect(() => new OllamaExecutionBackend()).not.toThrow();
	});

	it("should default OLLAMA_BASE_URL to http://localhost:11434", () => {
		const backend = new OllamaExecutionBackend();
		expect(backend.baseUrl).toBe("http://localhost:11434");
	});

	it("should use custom OLLAMA_BASE_URL from env", () => {
		process.env.OLLAMA_BASE_URL = "http://gpu-server:11434";
		const backend = new OllamaExecutionBackend();
		expect(backend.baseUrl).toBe("http://gpu-server:11434");
	});

	it("should override request model provider to openai for OpenAI-compatible API", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 100, outputTokens: 50 },
			durationMs: 500,
			events: [],
			conversationLog: [],
		} satisfies AgentRunResult);

		const backend = new OllamaExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		await backend.runAgent(makeRequest());

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

		const backend = new OllamaExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const controller = new AbortController();
		await backend.runAgent(makeRequest({ signal: controller.signal }));

		const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
		expect(calledRequest.signal).toBe(controller.signal);
	});

	it("should strip billing extras from token usage (local models are free)", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: {
				inputTokens: 100,
				outputTokens: 50,
				extras: [{ kind: "some.extra", tokens: 10, costMultiplier: 0.5 }],
			},
			durationMs: 500,
			events: [],
		} satisfies AgentRunResult);

		const backend = new OllamaExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const result = await backend.runAgent(makeRequest());
		expect(result.tokenUsage.extras).toBeUndefined();
	});
});
