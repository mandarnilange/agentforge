import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "mock-model",
		name: "mock-model",
		api: "openai-responses",
		provider: "openai",
	}),
	stream: vi.fn(),
}));

import { ProviderAwareBackend } from "../../src/adapters/execution/provider-aware-backend.js";
import { createPlatformBackendForExecutor } from "../../src/di/platform-container.js";
import { platformEstimateCostUsd } from "../../src/utils/platform-cost-calculator.js";

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "test-agent",
		systemPrompt: "You are a test agent.",
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
	artifacts: [{ type: "spec", path: "output.json", content: '{"test":true}' }],
	tokenUsage: { inputTokens: 500, outputTokens: 200 },
	durationMs: 1000,
	events: [],
	conversationLog: [],
};

describe("Multi-Provider Execution Integration", () => {
	const savedEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.OPENAI_API_KEY = "test-openai-key";
		process.env.GOOGLE_API_KEY = "test-google-key";
	});

	afterEach(() => {
		process.env = { ...savedEnv };
	});

	describe("provider-aware middleware", () => {
		it("should validate API keys per provider at call time", async () => {
			const innerRunAgent = vi.fn().mockResolvedValue(mockResult);
			const delegate: IExecutionBackend = { runAgent: innerRunAgent };
			const backend = new ProviderAwareBackend(delegate);

			// OpenAI with key works
			await backend.runAgent(
				makeRequest({
					model: {
						provider: "openai",
						name: "gpt-4o",
						maxTokens: 8192,
					},
				}),
			);
			expect(innerRunAgent).toHaveBeenCalledOnce();

			// Google with key works
			await backend.runAgent(
				makeRequest({
					model: {
						provider: "google",
						name: "gemini-2.5-pro",
						maxTokens: 8192,
					},
				}),
			);
			expect(innerRunAgent).toHaveBeenCalledTimes(2);
		});

		it("should reject OpenAI calls when key is missing", async () => {
			delete process.env.OPENAI_API_KEY;
			const delegate: IExecutionBackend = {
				runAgent: vi.fn().mockResolvedValue(mockResult),
			};
			const backend = new ProviderAwareBackend(delegate);

			await expect(
				backend.runAgent(
					makeRequest({
						model: {
							provider: "openai",
							name: "gpt-4o",
							maxTokens: 8192,
						},
					}),
				),
			).rejects.toThrow("OPENAI_API_KEY");
		});
	});

	describe("executor + provider are orthogonal", () => {
		it("should create same executor type for any provider", () => {
			// Both use pi-ai executor — the provider is in the request, not the executor
			const piAiBackend = createPlatformBackendForExecutor("pi-ai");
			const codingBackend = createPlatformBackendForExecutor("pi-coding-agent");

			expect(piAiBackend).toBeDefined();
			expect(codingBackend).toBeDefined();
		});
	});

	describe("provider-specific request transformation", () => {
		it("should map ollama provider to openai (OpenAI-compatible API)", async () => {
			const innerRunAgent = vi.fn().mockResolvedValue(mockResult);
			const backend = new ProviderAwareBackend({ runAgent: innerRunAgent });

			await backend.runAgent(
				makeRequest({
					model: {
						provider: "ollama",
						name: "llama3",
						maxTokens: 4096,
					},
				}),
			);

			const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
			expect(calledRequest.model.provider).toBe("openai");
		});

		it("should NOT remap openai or google providers", async () => {
			const innerRunAgent = vi.fn().mockResolvedValue(mockResult);
			const backend = new ProviderAwareBackend({ runAgent: innerRunAgent });

			await backend.runAgent(
				makeRequest({
					model: {
						provider: "openai",
						name: "gpt-4o",
						maxTokens: 8192,
					},
				}),
			);
			expect(
				(innerRunAgent.mock.calls[0][0] as AgentRunRequest).model.provider,
			).toBe("openai");

			await backend.runAgent(
				makeRequest({
					model: {
						provider: "google",
						name: "gemini-2.5-pro",
						maxTokens: 8192,
					},
				}),
			);
			expect(
				(innerRunAgent.mock.calls[1][0] as AgentRunRequest).model.provider,
			).toBe("google");
		});
	});

	describe("cost calculation per provider", () => {
		it("should calculate different costs for same token count across providers", () => {
			const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

			const openaiCost = platformEstimateCostUsd("gpt-4o", usage);
			const geminiCost = platformEstimateCostUsd("gemini-2.5-pro", usage);
			const ollamaCost = platformEstimateCostUsd("llama3", usage);
			const claudeCost = platformEstimateCostUsd(
				"claude-sonnet-4-20250514",
				usage,
			);

			expect(openaiCost).toBeGreaterThan(0);
			expect(geminiCost).toBeGreaterThan(0);
			expect(ollamaCost).toBe(0); // local = free
			expect(claudeCost).toBeGreaterThan(0);

			// All different prices
			expect(openaiCost).not.toBe(geminiCost);
			expect(openaiCost).not.toBe(claudeCost);
		});
	});

	describe("ollama strips billing extras", () => {
		it("should remove extras from token usage for local models", async () => {
			const resultWithExtras: AgentRunResult = {
				...mockResult,
				tokenUsage: {
					inputTokens: 100,
					outputTokens: 50,
					extras: [{ kind: "some.extra", tokens: 10, costMultiplier: 0.5 }],
				},
			};
			const innerRunAgent = vi.fn().mockResolvedValue(resultWithExtras);
			const backend = new ProviderAwareBackend({
				runAgent: innerRunAgent,
			});

			const result = await backend.runAgent(
				makeRequest({
					model: {
						provider: "ollama",
						name: "llama3",
						maxTokens: 4096,
					},
				}),
			);
			expect(result.tokenUsage.extras).toBeUndefined();
			expect(result.tokenUsage.inputTokens).toBe(100);
			expect(result.tokenUsage.outputTokens).toBe(50);
		});
	});
});
