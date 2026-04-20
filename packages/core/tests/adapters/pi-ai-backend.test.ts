import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRunRequest,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";

// Mock the pi-ai module before importing the backend
vi.mock("@mariozechner/pi-ai", () => {
	return {
		getModel: vi.fn().mockReturnValue({
			id: "claude-sonnet-4-20250514",
			name: "claude-sonnet-4-20250514",
			api: "anthropic-messages",
			provider: "anthropic",
		}),
		stream: vi.fn(),
	};
});

import { getModel, stream } from "@mariozechner/pi-ai";

type MockedStream = ReturnType<typeof stream>;

import { PiAiExecutionBackend } from "../../src/adapters/execution/pi-ai-backend.js";

const mockedStream = vi.mocked(stream);
const mockedGetModel = vi.mocked(getModel);

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

function makeAssistantMessage(
	text: string,
	usage = { input: 500, output: 300 },
) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		usage: {
			input: usage.input,
			output: usage.output,
			cost: { input: 0, output: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

/**
 * Creates a mock stream that yields no events and resolves with the given message
 */
function mockStreamResult(
	message: ReturnType<typeof makeAssistantMessage>,
): MockedStream {
	const asyncIterable = {
		async *[Symbol.asyncIterator]() {
			// no events
		},
		result: () => Promise.resolve(message),
	};
	return asyncIterable as unknown as MockedStream;
}

describe("PiAiExecutionBackend", () => {
	let backend: PiAiExecutionBackend;

	beforeEach(() => {
		vi.clearAllMocks();
		backend = new PiAiExecutionBackend();
	});

	function mockStreamWithEvents(
		events: Array<Record<string, unknown>>,
		message: ReturnType<typeof makeAssistantMessage>,
	): MockedStream {
		const asyncIterable = {
			async *[Symbol.asyncIterator]() {
				for (const event of events) {
					yield event;
				}
			},
			result: () => Promise.resolve(message),
		};
		return asyncIterable as unknown as MockedStream;
	}

	it("should implement IExecutionBackend", () => {
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	describe("runAgent", () => {
		it("should call getModel with provider and name from request", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const request = makeRequest();
			await backend.runAgent(request);

			expect(mockedGetModel).toHaveBeenCalledWith(
				"anthropic",
				"claude-sonnet-4-20250514",
			);
		});

		it("should call stream with system prompt and maxTokens", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			await backend.runAgent(makeRequest());

			expect(mockedStream).toHaveBeenCalledOnce();
			const [_model, context, options] = mockedStream.mock.calls[0];
			expect(context.systemPrompt).toBe("You are a BA.");
			expect(options?.maxTokens).toBe(8192);
		});

		it("should pass abort signal to stream options", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const controller = new AbortController();
			await backend.runAgent(makeRequest({ signal: controller.signal }));

			const [, , options] = mockedStream.mock.calls[0];
			expect(options?.signal).toBe(controller.signal);
		});

		it("should include input artifacts as context in user message", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			await backend.runAgent(
				makeRequest({
					inputArtifacts: [
						{ type: "brief", path: "brief.md", content: "Build an app" },
					],
				}),
			);

			const [, context] = mockedStream.mock.calls[0];
			const userMsg = context.messages[0];
			expect(userMsg.role).toBe("user");
			const msgContent =
				typeof userMsg.content === "string" ? userMsg.content : "";
			expect(msgContent).toContain("brief.md");
			expect(msgContent).toContain("Build an app");
		});

		it("should extract artifacts from JSON response with artifact keys as types", async () => {
			const responseText = JSON.stringify({
				artifacts: {
					frd: { projectName: "FreelanceFlow", epics: [] },
					nfr: { performance: { responseTime: "200ms" } },
				},
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toHaveLength(2);

			const types = result.artifacts.map((a) => a.type).sort();
			expect(types).toEqual(["frd", "nfr"]);

			// Content should be JSON string of the artifact data
			const frd = result.artifacts.find((a) => a.type === "frd");
			expect(JSON.parse(frd?.content).projectName).toBe("FreelanceFlow");
		});

		it("should extract JSON from markdown code blocks", async () => {
			const json = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			const responseText = `Here are the artifacts:\n\`\`\`json\n${json}\n\`\`\``;
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts[0].type).toBe("frd");
		});

		it("should return empty artifacts when no JSON found", async () => {
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage("No JSON here, just text")),
			);

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("should return token usage from response", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					makeAssistantMessage(responseText, { input: 1000, output: 5000 }),
				),
			);

			const result = await backend.runAgent(makeRequest());
			expect(result.tokenUsage.inputTokens).toBe(1000);
			expect(result.tokenUsage.outputTokens).toBe(5000);
		});

		it("should track duration", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const result = await backend.runAgent(makeRequest());
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("should return error event when stream fails", async () => {
			mockedStream.mockImplementationOnce(() => {
				throw new Error("API rate limited");
			});

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
		});

		it("should return conversationLog with user and assistant entries", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			const result = await backend.runAgent(
				makeRequest({
					inputArtifacts: [
						{ type: "other", path: "brief.md", content: "Build an app" },
					],
				}),
			);

			expect(result.conversationLog).toBeDefined();
			expect(result.conversationLog?.length).toBeGreaterThanOrEqual(2);

			const userEntry = result.conversationLog?.find((e) => e.role === "user");
			const assistantEntry = result.conversationLog?.find(
				(e) => e.role === "assistant",
			);
			expect(userEntry).toBeDefined();
			expect(assistantEntry).toBeDefined();
			expect(assistantEntry?.content).toContain("projectName");
		});
	});

	describe("stream event handling", () => {
		it("processes text_delta events and calls onEvent for large buffers", async () => {
			const eventCb = vi.fn();
			const b = new PiAiExecutionBackend({ onEvent: eventCb });
			const responseText = JSON.stringify({ artifacts: { frd: { x: 1 } } });
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[{ type: "text_delta", delta: "a".repeat(201) }],
					makeAssistantMessage(responseText),
				),
			);
			await b.runAgent(makeRequest());
			const assistantCalls = (
				eventCb.mock.calls as Array<[{ role: string }]>
			).filter(([a]) => a.role === "assistant");
			expect(assistantCalls.length).toBeGreaterThan(0);
		});

		it("processes text_delta events and flushes remaining buffer at end", async () => {
			const eventCb = vi.fn();
			const b = new PiAiExecutionBackend({ onEvent: eventCb });
			const responseText = JSON.stringify({ artifacts: { frd: { x: 1 } } });
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[{ type: "text_delta", delta: "small" }],
					makeAssistantMessage(responseText),
				),
			);
			await b.runAgent(makeRequest());
			const assistantCalls = (
				eventCb.mock.calls as Array<[{ role: string; content: string }]>
			).filter(([a]) => a.role === "assistant" && a.content === "small");
			expect(assistantCalls.length).toBeGreaterThan(0);
		});

		it("calls onProgress for text_delta events when buffer >= 200", async () => {
			const progressCb = vi.fn();
			const b = new PiAiExecutionBackend({ onProgress: progressCb });
			const responseText = JSON.stringify({ artifacts: { frd: { x: 1 } } });
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[{ type: "text_delta", delta: "x".repeat(201) }],
					makeAssistantMessage(responseText),
				),
			);
			await b.runAgent(makeRequest());
			expect(progressCb).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "progress",
					tokensOut: expect.any(Number),
				}),
			);
		});

		it("processes thinking_delta events", async () => {
			const eventCb = vi.fn();
			const b = new PiAiExecutionBackend({ onEvent: eventCb });
			const responseText = JSON.stringify({ artifacts: { frd: { x: 1 } } });
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[{ type: "thinking_delta", delta: "I am thinking..." }],
					makeAssistantMessage(responseText),
				),
			);
			await b.runAgent(makeRequest());
			const thinkingCalls = (
				eventCb.mock.calls as Array<[{ content: string }]>
			).filter(([a]) => a.content.includes("[thinking]"));
			expect(thinkingCalls.length).toBeGreaterThan(0);
		});

		it("throws when stream yields error event", async () => {
			const responseText = JSON.stringify({ artifacts: { frd: { x: 1 } } });
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[{ type: "error", error: "Rate limit exceeded" }],
					makeAssistantMessage(responseText),
				),
			);
			const result = await backend.runAgent(makeRequest());
			expect(result.events[0].kind).toBe("error");
		});

		it("throws when response has error stopReason", async () => {
			const msg = makeAssistantMessage("some text");
			(msg as Record<string, unknown>).stopReason = "error";
			(msg as Record<string, unknown>).errorMessage = "LLM error";
			mockedStream.mockReturnValueOnce(mockStreamResult(msg));
			const result = await backend.runAgent(makeRequest());
			expect(result.events[0].kind).toBe("error");
		});
	});

	describe("P39-T5 — retry on overloaded_error", () => {
		it("retries when stream yields an overloaded_error and succeeds on later attempt", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Retry" } },
			});
			// First attempt: error event with overloaded_error payload
			mockedStream.mockReturnValueOnce(
				mockStreamWithEvents(
					[
						{
							type: "error",
							error: JSON.stringify({
								error: { type: "overloaded_error", message: "Overloaded" },
							}),
						},
					],
					makeAssistantMessage(responseText),
				),
			);
			// Second attempt: success
			mockedStream.mockReturnValueOnce(
				mockStreamResult(makeAssistantMessage(responseText)),
			);

			// Patch retry to use tiny backoff for test speed — we do this by
			// re-instantiating with short delays via env or just accepting default
			// and shortening via a vi.useFakeTimers pattern. Here we call directly
			// and trust the retry helper test coverage; the backend simply delegates.
			const result = await backend.runAgent(makeRequest());
			expect(mockedStream).toHaveBeenCalledTimes(2);
			expect(result.artifacts).toHaveLength(1);
			expect(result.events.filter((e) => e.kind === "error")).toHaveLength(0);
		}, 15_000);

		it("does not retry on non-overloaded errors", async () => {
			mockedStream.mockImplementationOnce(() => {
				throw new Error("authentication_error: invalid API key");
			});

			const result = await backend.runAgent(makeRequest());
			expect(mockedStream).toHaveBeenCalledTimes(1);
			expect(result.events[0].kind).toBe("error");
		});

		it("humanizes JSON-encoded error messages in error events", async () => {
			mockedStream.mockImplementationOnce(() => {
				throw new Error(
					JSON.stringify({
						error: { type: "authentication_error", message: "bad key" },
					}),
				);
			});

			const result = await backend.runAgent(makeRequest());
			expect(result.events[0].kind).toBe("error");
			const msg = (result.events[0] as { message: string }).message;
			expect(msg).toBe("bad key");
		});
	});

	describe("parseArtifacts edge cases", () => {
		it("returns empty when response content has no text items", async () => {
			const msg = {
				role: "assistant" as const,
				content: [
					{ type: "image" as const, url: "http://example.com/img.png" },
				],
				usage: {
					input: 100,
					output: 50,
					cost: { input: 0, output: 0, total: 0 },
				},
				stopReason: "stop" as const,
				timestamp: Date.now(),
			};
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					msg as unknown as ReturnType<typeof makeAssistantMessage>,
				),
			);
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when JSON parses to non-object", async () => {
			const msg = makeAssistantMessage("```json\n42\n```");
			mockedStream.mockReturnValueOnce(mockStreamResult(msg));
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when artifacts field is non-object", async () => {
			const msg = makeAssistantMessage('{"artifacts": 99}');
			mockedStream.mockReturnValueOnce(mockStreamResult(msg));
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when JSON is malformed", async () => {
			const msg = makeAssistantMessage("{invalid: not json}");
			mockedStream.mockReturnValueOnce(mockStreamResult(msg));
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});
	});

	describe("P38 — budget enforcement", () => {
		it("adds no budget_exceeded event when within maxTotalTokens", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					makeAssistantMessage(responseText, { input: 1000, output: 500 }),
				),
			);

			const result = await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 150_000 } }),
			);
			const budgetEvents = result.events.filter(
				(e) => e.kind === "budget_exceeded",
			);
			expect(budgetEvents).toHaveLength(0);
		});

		it("adds budget_exceeded warning event when total tokens exceed maxTotalTokens", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			// Simulate response with high token usage: 100k in + 60k out = 160k total
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					makeAssistantMessage(responseText, {
						input: 100_000,
						output: 60_000,
					}),
				),
			);

			const result = await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 150_000 } }),
			);
			const budgetEvents = result.events.filter(
				(e) => e.kind === "budget_exceeded",
			);
			expect(budgetEvents).toHaveLength(1);
			const ev = budgetEvents[0] as { kind: string; reason: string };
			expect(ev.reason).toMatch(/Token budget/);
		});

		it("adds budget_exceeded warning event when cost exceeds maxCostUsd", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			// 50k in + 50k out at sonnet pricing = $0.15 + $0.75 = $0.90, exceeds $0.50
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					makeAssistantMessage(responseText, { input: 50_000, output: 50_000 }),
				),
			);

			const result = await backend.runAgent(
				makeRequest({ budget: { maxCostUsd: 0.5 } }),
			);
			const budgetEvents = result.events.filter(
				(e) => e.kind === "budget_exceeded",
			);
			expect(budgetEvents).toHaveLength(1);
			const ev = budgetEvents[0] as { kind: string; reason: string };
			expect(ev.reason).toMatch(/Cost budget/);
		});

		it("still returns artifacts even when budget is exceeded (single-turn: can't abort)", async () => {
			const responseText = JSON.stringify({
				artifacts: { frd: { projectName: "Test" } },
			});
			mockedStream.mockReturnValueOnce(
				mockStreamResult(
					makeAssistantMessage(responseText, {
						input: 100_000,
						output: 60_000,
					}),
				),
			);

			const result = await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 150_000 } }),
			);
			// Artifacts still present (cannot abort a completed single-turn call)
			expect(result.artifacts).toHaveLength(1);
		});
	});
});
