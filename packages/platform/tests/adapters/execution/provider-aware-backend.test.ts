import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getSupportedProviders,
	ProviderAwareBackend,
} from "../../../src/adapters/execution/provider-aware-backend.js";

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "analyst",
		systemPrompt: "You are a BA.",
		inputArtifacts: [],
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4-20250514",
			maxTokens: 8192,
		},
		...overrides,
	};
}

const mockResult: AgentRunResult = {
	artifacts: [],
	tokenUsage: { inputTokens: 500, outputTokens: 200 },
	durationMs: 1000,
	events: [],
	conversationLog: [],
};

describe("ProviderAwareBackend", () => {
	const savedEnv = { ...process.env };
	let innerRunAgent: ReturnType<typeof vi.fn>;
	let delegate: IExecutionBackend;
	let backend: ProviderAwareBackend;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.OPENAI_API_KEY = "test-openai-key";
		process.env.GOOGLE_API_KEY = "test-google-key";
		innerRunAgent = vi.fn().mockResolvedValue(mockResult);
		delegate = { runAgent: innerRunAgent };
		backend = new ProviderAwareBackend(delegate);
	});

	afterEach(() => {
		process.env = { ...savedEnv };
	});

	it("should implement IExecutionBackend", () => {
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	describe("anthropic provider", () => {
		it("should pass through requests for anthropic unchanged", async () => {
			const request = makeRequest();
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("anthropic");
		});
	});

	describe("openai provider", () => {
		it("should throw if OPENAI_API_KEY is missing", async () => {
			delete process.env.OPENAI_API_KEY;
			const request = makeRequest({
				model: { provider: "openai", name: "gpt-4o", maxTokens: 8192 },
			});

			await expect(backend.runAgent(request)).rejects.toThrow("OPENAI_API_KEY");
		});

		it("should pass through provider as openai", async () => {
			const request = makeRequest({
				model: { provider: "openai", name: "gpt-4o", maxTokens: 8192 },
			});
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("openai");
		});
	});

	describe("google provider", () => {
		it("should throw if GOOGLE_API_KEY is missing", async () => {
			delete process.env.GOOGLE_API_KEY;
			const request = makeRequest({
				model: {
					provider: "google",
					name: "gemini-2.5-pro",
					maxTokens: 8192,
				},
			});

			await expect(backend.runAgent(request)).rejects.toThrow("GOOGLE_API_KEY");
		});

		it("should pass through provider as google", async () => {
			const request = makeRequest({
				model: {
					provider: "google",
					name: "gemini-2.5-pro",
					maxTokens: 8192,
				},
			});
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("google");
		});
	});

	describe("ollama provider", () => {
		it("should NOT require an API key", async () => {
			delete process.env.OPENAI_API_KEY;
			const request = makeRequest({
				model: { provider: "ollama", name: "llama3", maxTokens: 4096 },
			});

			await expect(backend.runAgent(request)).resolves.toBeDefined();
		});

		it("should map ollama provider to openai for OpenAI-compatible API", async () => {
			const request = makeRequest({
				model: { provider: "ollama", name: "llama3", maxTokens: 4096 },
			});
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("openai");
		});

		it("should strip billing extras for local models", async () => {
			const resultWithExtras: AgentRunResult = {
				...mockResult,
				tokenUsage: {
					inputTokens: 100,
					outputTokens: 50,
					extras: [{ kind: "some.extra", tokens: 10, costMultiplier: 0.5 }],
				},
			};
			innerRunAgent.mockResolvedValue(resultWithExtras);

			const request = makeRequest({
				model: { provider: "ollama", name: "llama3", maxTokens: 4096 },
			});
			const result = await backend.runAgent(request);

			expect(result.tokenUsage.extras).toBeUndefined();
			expect(result.tokenUsage.inputTokens).toBe(100);
			expect(result.tokenUsage.outputTokens).toBe(50);
		});
	});

	describe("unknown provider", () => {
		it("should pass through unknown providers without validation", async () => {
			const request = makeRequest({
				model: {
					provider: "custom-provider",
					name: "custom-model",
					maxTokens: 4096,
				},
			});
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("custom-provider");
		});
	});

	describe("signal passthrough", () => {
		it("should pass abort signal through to delegate", async () => {
			const controller = new AbortController();
			const request = makeRequest({ signal: controller.signal });
			await backend.runAgent(request);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.signal).toBe(controller.signal);
		});
	});

	describe("getSupportedProviders", () => {
		it("should list all configured providers", () => {
			const providers = getSupportedProviders();
			expect(providers).toContain("openai");
			expect(providers).toContain("google");
			expect(providers).toContain("ollama");
		});
	});
});
