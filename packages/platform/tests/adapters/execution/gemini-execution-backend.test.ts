import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "gemini-2.5-pro",
		name: "gemini-2.5-pro",
		api: "google-generative-ai",
		provider: "google",
	}),
	stream: vi.fn(),
}));

import { GeminiExecutionBackend } from "../../../src/adapters/execution/gemini-execution-backend.js";

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "analyst",
		systemPrompt: "You are a BA.",
		inputArtifacts: [],
		model: {
			provider: "google",
			name: "gemini-2.5-pro",
			maxTokens: 8192,
		},
		...overrides,
	};
}

describe("GeminiExecutionBackend", () => {
	const originalEnv = process.env.GOOGLE_API_KEY;

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.GOOGLE_API_KEY = "test-google-key";
	});

	afterEach(() => {
		if (originalEnv !== undefined) {
			process.env.GOOGLE_API_KEY = originalEnv;
		} else {
			delete process.env.GOOGLE_API_KEY;
		}
	});

	it("should implement IExecutionBackend", () => {
		const backend = new GeminiExecutionBackend();
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	it("should throw if GOOGLE_API_KEY is not set", () => {
		delete process.env.GOOGLE_API_KEY;
		expect(() => new GeminiExecutionBackend()).toThrow("GOOGLE_API_KEY");
	});

	it("should override request model provider to google", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 100, outputTokens: 50 },
			durationMs: 500,
			events: [],
			conversationLog: [],
		} satisfies AgentRunResult);

		const backend = new GeminiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		await backend.runAgent(
			makeRequest({
				model: {
					provider: "anything",
					name: "gemini-2.5-pro",
					maxTokens: 8192,
				},
			}),
		);

		const calledRequest = innerRunAgent.mock.calls[0][0] as AgentRunRequest;
		expect(calledRequest.model.provider).toBe("google");
	});

	it("should pass through abort signal to delegate", async () => {
		const innerRunAgent = vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 0,
			events: [],
		} satisfies AgentRunResult);

		const backend = new GeminiExecutionBackend({
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
				{ kind: "error", timestamp: Date.now(), message: "Quota exceeded" },
			],
		} satisfies AgentRunResult);

		const backend = new GeminiExecutionBackend({
			delegateBackend: { runAgent: innerRunAgent },
		});

		const result = await backend.runAgent(makeRequest());
		expect(result.events[0].kind).toBe("error");
	});
});
