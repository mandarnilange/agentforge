import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentRunRequest,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";

// Mock pi-agent-core Agent class
const mockPrompt = vi.fn();
const mockSubscribe = vi.fn().mockReturnValue(() => {});
const mockAbort = vi.fn();
const mockState = {
	messages: [] as unknown[],
	systemPrompt: "",
	model: {},
	thinkingLevel: "medium",
	tools: [],
	isStreaming: false,
	pendingToolCalls: new Set(),
};
const mockGetState = vi.fn().mockReturnValue(mockState);

vi.mock("@mariozechner/pi-agent-core", () => {
	class MockAgent {
		prompt = mockPrompt;
		subscribe = mockSubscribe;
		abort = mockAbort;
		get state() {
			return mockGetState();
		}
		constructor(opts?: unknown) {
			mockAgentConstructor(opts);
		}
	}
	return {
		Agent: MockAgent,
	};
});

const mockAgentConstructor = vi.fn();

vi.mock("@mariozechner/pi-ai", () => {
	return {
		getModel: vi.fn().mockReturnValue({
			id: "claude-sonnet-4-20250514",
			name: "claude-sonnet-4-20250514",
			api: "anthropic-messages",
			provider: "anthropic",
		}),
	};
});

const mockLoadExtensions = vi.fn();
const mockCreateEventBus = vi.fn().mockReturnValue({ emit: vi.fn() });

vi.mock("@mariozechner/pi-coding-agent", () => {
	return {
		createCodingTools: vi
			.fn()
			.mockReturnValue([
				{ name: "read" },
				{ name: "write" },
				{ name: "edit" },
				{ name: "bash" },
				{ name: "grep" },
				{ name: "find" },
				{ name: "ls" },
			]),
		discoverAndLoadExtensions: (...args: unknown[]) =>
			mockLoadExtensions(...args),
		createEventBus: (...args: unknown[]) => mockCreateEventBus(...args),
	};
});

import { getModel } from "@mariozechner/pi-ai";
import {
	PiCodingAgentExecutionBackend,
	stringifyToolPayload,
} from "../../src/adapters/execution/pi-coding-agent-backend.js";

const mockedGetModel = vi.mocked(getModel);

function makeRequest(
	overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
	return {
		agentId: "developer",
		systemPrompt: "You are a backend developer.",
		inputArtifacts: [],
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4-20250514",
			maxTokens: 8192,
		},
		...overrides,
	};
}

describe("PiCodingAgentExecutionBackend", () => {
	let backend: PiCodingAgentExecutionBackend;

	beforeEach(() => {
		vi.clearAllMocks();
		mockPrompt.mockResolvedValue(undefined);
		mockGetState.mockReturnValue({
			...mockState,
			messages: [],
		});
		mockLoadExtensions.mockResolvedValue({
			extensions: [],
			errors: [],
			runtime: {},
		});
		backend = new PiCodingAgentExecutionBackend();
	});

	it("should implement IExecutionBackend", () => {
		const _check: IExecutionBackend = backend;
		expect(backend.runAgent).toBeDefined();
	});

	it("should accept an optional onProgress callback", () => {
		const cb = vi.fn();
		const b = new PiCodingAgentExecutionBackend({ onProgress: cb });
		expect(b).toBeDefined();
	});

	describe("runAgent", () => {
		it("should call getModel with provider and name from request", async () => {
			const request = makeRequest();
			await backend.runAgent(request);

			expect(mockedGetModel).toHaveBeenCalledWith(
				"anthropic",
				"claude-sonnet-4-20250514",
			);
		});

		it("should create an Agent with system prompt and model", async () => {
			await backend.runAgent(makeRequest());

			expect(mockAgentConstructor).toHaveBeenCalledOnce();
			const opts = mockAgentConstructor.mock.calls[0][0];
			expect(opts?.initialState?.systemPrompt).toBe(
				"You are a backend developer.",
			);
			expect(opts?.initialState?.model).toBeDefined();
			expect(opts?.initialState?.thinkingLevel).toBe("medium");
		});

		it("should subscribe to agent events", async () => {
			await backend.runAgent(makeRequest());
			expect(mockSubscribe).toHaveBeenCalledOnce();
		});

		it("should call agent.prompt with built user message", async () => {
			await backend.runAgent(makeRequest());

			expect(mockPrompt).toHaveBeenCalledOnce();
			const promptArg = mockPrompt.mock.calls[0][0];
			expect(typeof promptArg).toBe("string");
		});

		it("should include input artifacts in the prompt", async () => {
			await backend.runAgent(
				makeRequest({
					inputArtifacts: [
						{
							type: "spec",
							path: "architecture.json",
							content: '{"layers": ["api", "domain"]}',
						},
					],
				}),
			);

			const promptArg = mockPrompt.mock.calls[0][0] as string;
			expect(promptArg).toContain("architecture.json");
			expect(promptArg).toContain('{"layers": ["api", "domain"]}');
		});

		it("should include multiple input artifacts in the prompt", async () => {
			await backend.runAgent(
				makeRequest({
					inputArtifacts: [
						{ type: "spec", path: "frd.json", content: '{"epics": []}' },
						{
							type: "spec",
							path: "sprint-plan.json",
							content: '{"sprints": []}',
						},
					],
				}),
			);

			const promptArg = mockPrompt.mock.calls[0][0] as string;
			expect(promptArg).toContain("frd.json");
			expect(promptArg).toContain("sprint-plan.json");
		});

		it("should include output instructions in the prompt", async () => {
			await backend.runAgent(makeRequest());

			const promptArg = mockPrompt.mock.calls[0][0] as string;
			expect(promptArg).toContain("artifacts");
			expect(promptArg).toContain("JSON");
		});

		it("should extract artifacts from assistant response containing JSON", async () => {
			const responseJson = JSON.stringify({
				artifacts: {
					"api-code": { files: ["src/index.ts"] },
					"openapi-spec": { openapi: "3.0.0" },
				},
			});

			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{ role: "user", content: "test", timestamp: Date.now() },
					{
						role: "assistant",
						content: [{ type: "text", text: responseJson }],
						stopReason: "stop",
						timestamp: Date.now(),
					},
				],
			});

			const result = await backend.runAgent(makeRequest());

			expect(result.artifacts).toHaveLength(2);
			const types = result.artifacts.map((a) => a.type).sort();
			expect(types).toEqual(["api-code", "openapi-spec"]);
		});

		it("should extract artifacts from JSON inside markdown code blocks", async () => {
			const json = JSON.stringify({
				artifacts: { "api-code": { files: ["app.ts"] } },
			});
			const text = `Here are the results:\n\`\`\`json\n${json}\n\`\`\``;

			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text }],
						stopReason: "stop",
						timestamp: Date.now(),
					},
				],
			});

			const result = await backend.runAgent(makeRequest());

			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts[0].type).toBe("api-code");
		});

		it("should return empty artifacts when response has no JSON", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "I created the files." }],
						stopReason: "stop",
						timestamp: Date.now(),
					},
				],
			});

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("should return empty artifacts when no assistant messages exist", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [],
			});

			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("should track duration", async () => {
			const result = await backend.runAgent(makeRequest());
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("should return token usage as zero (tracked internally by pi-agent-core)", async () => {
			const result = await backend.runAgent(makeRequest());
			expect(result.tokenUsage).toEqual({
				inputTokens: 0,
				outputTokens: 0,
			});
		});

		it("should return error event when agent.prompt throws", async () => {
			mockPrompt.mockRejectedValueOnce(new Error("API rate limited"));

			const result = await backend.runAgent(makeRequest());

			expect(result.artifacts).toEqual([]);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
			if (result.events[0].kind === "error") {
				expect(result.events[0].message).toBe("API rate limited");
			}
		});

		it("should return error event with generic message for non-Error throws", async () => {
			mockPrompt.mockRejectedValueOnce("string error");

			const result = await backend.runAgent(makeRequest());

			expect(result.events).toHaveLength(1);
			if (result.events[0].kind === "error") {
				expect(result.events[0].message).toBe("Unknown error during agent run");
			}
		});

		it("should call onProgress callback when agent emits events", async () => {
			const progressCb = vi.fn();
			const b = new PiCodingAgentExecutionBackend({
				onProgress: progressCb,
			});

			// Capture the subscriber function and invoke it
			let subscriberFn: ((event: unknown) => void) | undefined;
			mockSubscribe.mockImplementation((fn: (event: unknown) => void) => {
				subscriberFn = fn;
				return () => {};
			});

			await b.runAgent(makeRequest());

			expect(subscriberFn).toBeDefined();
			// Simulate an event
			subscriberFn?.(
				{ type: "message_update", message: {}, assistantMessageEvent: {} },
				new AbortController().signal,
			);
			expect(progressCb).toHaveBeenCalledWith({
				type: "progress",
				text: "generating...",
			});
		});

		it("should use the last assistant message for artifact extraction", async () => {
			const earlyJson = JSON.stringify({
				artifacts: { old: { version: 1 } },
			});
			const finalJson = JSON.stringify({
				artifacts: { "api-code": { files: ["final.ts"] } },
			});

			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: earlyJson }],
						stopReason: "stop",
						timestamp: Date.now(),
					},
					{ role: "user", content: "continue", timestamp: Date.now() },
					{
						role: "assistant",
						content: [{ type: "text", text: finalJson }],
						stopReason: "stop",
						timestamp: Date.now(),
					},
				],
			});

			const result = await backend.runAgent(makeRequest());

			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts[0].type).toBe("api-code");
		});
	});

	describe("convertToLlm filter function", () => {
		it("filters to only user, assistant, and toolResult messages", async () => {
			await backend.runAgent(makeRequest());
			const opts = mockAgentConstructor.mock.calls[0][0] as {
				convertToLlm: (
					msgs: Array<{ role: string }>,
				) => Array<{ role: string }>;
			};
			const filtered = opts.convertToLlm([
				{ role: "user" },
				{ role: "assistant" },
				{ role: "system" },
				{ role: "toolResult" },
			]);
			expect(filtered).toHaveLength(3);
			expect(filtered.map((m) => m.role).sort()).toEqual([
				"assistant",
				"toolResult",
				"user",
			]);
		});
	});

	describe("subscribe event handlers", () => {
		function captureSubscriberAndEvent(options?: {
			onProgress?: ReturnType<typeof vi.fn>;
			onEvent?: ReturnType<typeof vi.fn>;
		}) {
			let subscriberFn: ((event: unknown) => void) | undefined;
			mockSubscribe.mockImplementation((fn: (event: unknown) => void) => {
				subscriberFn = fn;
				return () => {};
			});
			const eventCb = options?.onEvent ?? vi.fn();
			const progressCb = options?.onProgress ?? vi.fn();
			const b = new PiCodingAgentExecutionBackend({
				onEvent: eventCb,
				onProgress: progressCb,
			});
			return { subscriberFn: () => subscriberFn, eventCb, progressCb, b };
		}

		it("calls onEvent when text_delta fills buffer to >= 200 chars", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "a".repeat(201) },
			});
			expect(eventCb).toHaveBeenCalledWith(
				expect.objectContaining({ role: "assistant" }),
			);
		});

		it("calls onEvent with thinking content for thinking_delta", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "message_update",
				assistantMessageEvent: {
					type: "thinking_delta",
					delta: "reasoning...",
				},
			});
			expect(eventCb).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "assistant",
					content: expect.stringContaining("[thinking]"),
				}),
			);
		});

		it("flushes pending text buffer on message_end", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "pending" },
			});
			subscriberFn()?.({ type: "message_end" });
			const assistantCalls = (
				eventCb.mock.calls as Array<[{ role: string; content: string }]>
			).filter(([a]) => a.role === "assistant" && a.content === "pending");
			expect(assistantCalls.length).toBeGreaterThan(0);
		});

		it("fires tool_call event on tool_execution_start", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "tool_execution_start",
				toolName: "bash",
				args: { command: "ls" },
			});
			const toolCallEvents = (
				eventCb.mock.calls as Array<[{ role: string }]>
			).filter(([a]) => a.role === "tool_call");
			expect(toolCallEvents).toHaveLength(1);
		});

		it("flushes text buffer before tool_execution_start", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "message_update",
				assistantMessageEvent: { type: "text_delta", delta: "buffered" },
			});
			subscriberFn()?.({
				type: "tool_execution_start",
				toolName: "bash",
				args: {},
			});
			const assistantCalls = (
				eventCb.mock.calls as Array<[{ role: string; content: string }]>
			).filter(([a]) => a.role === "assistant" && a.content === "buffered");
			expect(assistantCalls.length).toBeGreaterThan(0);
		});

		it("fires tool_result event on tool_execution_end", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({
				type: "tool_execution_start",
				toolName: "read_file",
				args: {},
			});
			subscriberFn()?.({
				type: "tool_execution_end",
				toolName: "read_file",
				result: "file content",
			});
			const toolResults = (
				eventCb.mock.calls as Array<[{ role: string }]>
			).filter(([a]) => a.role === "tool_result");
			expect(toolResults).toHaveLength(1);
		});

		it("fires turn_start and turn_end events", async () => {
			const { subscriberFn, eventCb, b } = captureSubscriberAndEvent();
			await b.runAgent(makeRequest());
			subscriberFn()?.({ type: "turn_start" });
			subscriberFn()?.({ type: "turn_end" });
			const turnContents = (
				eventCb.mock.calls as Array<[{ content: string }]>
			).map(([a]) => a.content);
			expect(turnContents).toContain("[turn_start]");
			expect(turnContents).toContain("[turn_end]");
		});
	});

	describe("error cleanup with active spans", () => {
		it("cleans up active tool spans when prompt throws", async () => {
			let capturedSubscriber: ((event: unknown) => void) | undefined;
			mockSubscribe.mockImplementation((fn: (event: unknown) => void) => {
				capturedSubscriber = fn;
				return () => {};
			});
			mockPrompt.mockImplementation(async () => {
				capturedSubscriber?.({
					type: "tool_execution_start",
					toolName: "bash",
					args: {},
				});
				throw new Error("Network failure during agent run");
			});
			const b = new PiCodingAgentExecutionBackend();
			const result = await b.runAgent(makeRequest());
			expect(result.events[0].kind).toBe("error");
		});
	});

	describe("parseArtifacts edge cases", () => {
		it("returns empty when assistant content is a string (not array)", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{ role: "assistant", content: "plain string", timestamp: Date.now() },
				],
			});
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when content array has no text items", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "image", url: "http://example.com/img.png" }],
						timestamp: Date.now(),
					},
				],
			});
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when code block contains non-object JSON value", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "```json\n42\n```" }],
						timestamp: Date.now(),
					},
				],
			});
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when artifacts field is a non-object primitive", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: '{"artifacts": 99}' }],
						timestamp: Date.now(),
					},
				],
			});
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});

		it("returns empty when JSON is malformed", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "{invalid: not json}" }],
						timestamp: Date.now(),
					},
				],
			});
			const result = await backend.runAgent(makeRequest());
			expect(result.artifacts).toEqual([]);
		});
	});

	describe("tools filtering", () => {
		it("should pass all coding tools when no tools filter specified", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest());

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames).toEqual(
				expect.arrayContaining([
					"read",
					"write",
					"edit",
					"bash",
					"grep",
					"find",
					"ls",
				]),
			);
		});

		it("should filter tools when tools list is specified in request", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest({ tools: ["read", "grep", "find"] }));

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames).toEqual(["read", "grep", "find"]);
		});

		it("should pass empty tools when workdir is not set regardless of tools filter", async () => {
			const b = new PiCodingAgentExecutionBackend();
			await b.runAgent(makeRequest({ tools: ["read", "bash"] }));

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			expect(opts.initialState.tools).toEqual([]);
		});

		it("should ignore unknown tool names in the filter", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest({ tools: ["read", "nonexistent_tool"] }));

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames).toEqual(["read"]);
		});

		it("should not filter tools when tools array is empty", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest({ tools: [] }));

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames.length).toBeGreaterThanOrEqual(7);
		});
	});

	describe("extensions loading", () => {
		it("should accept extensions in AgentRunRequest", async () => {
			const request = makeRequest({
				extensions: ["extensions/my-tool.ts"],
			});
			expect(request.extensions).toEqual(["extensions/my-tool.ts"]);
		});

		it("should reject absolute extension paths", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			const result = await b.runAgent(
				makeRequest({ extensions: ["/etc/malicious.ts"] }),
			);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
			if (result.events[0].kind === "error") {
				expect(result.events[0].message).toContain("absolute");
			}
		});

		it("should reject extension paths with .. traversal", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			const result = await b.runAgent(
				makeRequest({ extensions: ["../../../etc/passwd.ts"] }),
			);
			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
			if (result.events[0].kind === "error") {
				expect(result.events[0].message).toContain("traversal");
			}
		});

		it("should not load extensions when extensions list is empty", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest({ extensions: [] }));

			// Should succeed without attempting to load
			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			expect(opts.initialState.tools.length).toBeGreaterThanOrEqual(7);
			expect(mockLoadExtensions).not.toHaveBeenCalled();
		});

		it("should not call loadExtensions when extensions is undefined (e.g. cross-cutting agent)", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest());
			expect(mockLoadExtensions).not.toHaveBeenCalled();
		});

		it("should call loadExtensions with request paths and agentforgeDir", async () => {
			const b = new PiCodingAgentExecutionBackend({
				workdir: "/tmp/test",
				agentforgeDir: "/tmp/test/.agentforge",
			});
			await b.runAgent(makeRequest({ extensions: ["extensions/skill.ts"] }));

			expect(mockLoadExtensions).toHaveBeenCalledTimes(1);
			const [paths, cwd] = mockLoadExtensions.mock.calls[0];
			expect(paths).toEqual(["extensions/skill.ts"]);
			expect(cwd).toBe("/tmp/test/.agentforge");
		});

		it("should fall back to workdir for loadExtensions cwd when agentforgeDir is unset", async () => {
			const b = new PiCodingAgentExecutionBackend({ workdir: "/tmp/test" });
			await b.runAgent(makeRequest({ extensions: ["extensions/skill.ts"] }));

			const [, cwd] = mockLoadExtensions.mock.calls[0];
			expect(cwd).toBe("/tmp/test");
		});

		it("should merge tools from loaded extensions into the Agent toolset", async () => {
			mockLoadExtensions.mockResolvedValue({
				extensions: [
					{
						tools: new Map([
							[
								"example_hello",
								{ definition: { name: "example_hello" }, sourceInfo: {} },
							],
						]),
					},
				],
				errors: [],
				runtime: {},
			});
			const b = new PiCodingAgentExecutionBackend({
				workdir: "/tmp/test",
				agentforgeDir: "/tmp/test/.agentforge",
			});
			await b.runAgent(makeRequest({ extensions: ["extensions/hello.ts"] }));

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames).toContain("example_hello");
		});

		it("should append extension tools even when YAML tools filter is present", async () => {
			mockLoadExtensions.mockResolvedValue({
				extensions: [
					{
						tools: new Map([
							[
								"example_hello",
								{ definition: { name: "example_hello" }, sourceInfo: {} },
							],
						]),
					},
				],
				errors: [],
				runtime: {},
			});
			const b = new PiCodingAgentExecutionBackend({
				workdir: "/tmp/test",
				agentforgeDir: "/tmp/test/.agentforge",
			});
			await b.runAgent(
				makeRequest({
					tools: ["read"],
					extensions: ["extensions/hello.ts"],
				}),
			);

			const opts = mockAgentConstructor.mock.calls[0][0] as {
				initialState: { tools: Array<{ name: string }> };
			};
			const toolNames = opts.initialState.tools.map((t) => t.name);
			expect(toolNames).toEqual(["read", "example_hello"]);
		});

		it("should surface extension loader errors as events without constructing an Agent", async () => {
			mockLoadExtensions.mockResolvedValue({
				extensions: [],
				errors: [{ path: "extensions/broken.ts", error: "SyntaxError: boom" }],
				runtime: {},
			});
			const b = new PiCodingAgentExecutionBackend({
				workdir: "/tmp/test",
				agentforgeDir: "/tmp/test/.agentforge",
			});
			const result = await b.runAgent(
				makeRequest({ extensions: ["extensions/broken.ts"] }),
			);

			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
			if (result.events[0].kind === "error") {
				expect(result.events[0].message).toContain("extensions/broken.ts");
				expect(result.events[0].message).toContain("SyntaxError: boom");
			}
			expect(mockAgentConstructor).not.toHaveBeenCalled();
		});
	});

	describe("P38 — budget enforcement", () => {
		it("adds no budget_exceeded event when no budget set", async () => {
			const result = await backend.runAgent(makeRequest());
			const budgetEvents = result.events.filter(
				(e) => e.kind === "budget_exceeded",
			);
			expect(budgetEvents).toHaveLength(0);
		});

		it("adds no budget_exceeded event when within token budget", async () => {
			// State has 0 messages => 0 tokens; well within 150k limit
			const result = await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 150_000 } }),
			);
			const budgetEvents = result.events.filter(
				(e) => e.kind === "budget_exceeded",
			);
			expect(budgetEvents).toHaveLength(0);
		});

		it("adds budget_exceeded event when cumulative tokens exceed maxTotalTokens", async () => {
			// Simulate two assistant messages totalling 160k tokens
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "turn 1" }],
						usage: { input: 80_000, output: 40_000 },
						timestamp: Date.now(),
					},
					{
						role: "assistant",
						content: [{ type: "text", text: "turn 2" }],
						usage: { input: 30_000, output: 10_000 },
						timestamp: Date.now(),
					},
				],
			});

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

		it("adds budget_exceeded event when cumulative cost exceeds maxCostUsd", async () => {
			// 50k in + 50k out at sonnet pricing ($3/M in, $15/M out) = $0.15 + $0.75 = $0.90
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "done" }],
						usage: { input: 50_000, output: 50_000 },
						timestamp: Date.now(),
					},
				],
			});

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

		it("calls agent.abort() on turn_end when cumulative tokens already exceed budget", async () => {
			let subscriberFn: ((event: unknown) => void) | undefined;
			mockSubscribe.mockImplementationOnce((fn: (event: unknown) => void) => {
				subscriberFn = fn;
				return () => {};
			});

			// Simulate: after this turn the state already has 160k tokens > 50k budget
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "turn done" }],
						usage: { input: 80_000, output: 80_000 },
						timestamp: Date.now(),
					},
				],
			});

			// Fire turn_end synchronously during agent.prompt() execution
			mockPrompt.mockImplementationOnce(async () => {
				subscriberFn?.({ type: "turn_end" });
			});

			await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 50_000 } }),
			);

			expect(mockAbort).toHaveBeenCalledOnce();
		});

		it("does not call agent.abort() on turn_end when within budget", async () => {
			let subscriberFn: ((event: unknown) => void) | undefined;
			mockSubscribe.mockImplementationOnce((fn: (event: unknown) => void) => {
				subscriberFn = fn;
				return () => {};
			});

			// 0 tokens — well within 50k limit
			mockGetState.mockReturnValue({ ...mockState, messages: [] });

			mockPrompt.mockImplementationOnce(async () => {
				subscriberFn?.({ type: "turn_end" });
			});

			await backend.runAgent(
				makeRequest({ budget: { maxTotalTokens: 50_000 } }),
			);

			expect(mockAbort).not.toHaveBeenCalled();
		});
	});

	describe("buildConversationLog", () => {
		it("includes toolResult entries as tool_result role", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "toolResult",
						content: undefined,
						output: "file contents here",
						toolName: "read_file",
						timestamp: Date.now(),
					},
				],
			});
			const result = await backend.runAgent(makeRequest());
			const toolResults = (result.conversationLog ?? []).filter(
				(e) => e.role === "tool_result",
			);
			expect(toolResults).toHaveLength(1);
			expect(toolResults[0].name).toBe("read_file");
		});

		it("includes assistant entries when content is a string", async () => {
			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{ role: "assistant", content: "hello there", timestamp: Date.now() },
				],
			});
			const result = await backend.runAgent(makeRequest());
			const assistantEntries = (result.conversationLog ?? []).filter(
				(e) => e.role === "assistant",
			);
			expect(assistantEntries.length).toBeGreaterThan(0);
		});
	});

	describe("retry with exponential backoff on overloaded_error", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("retries on overloaded_error and succeeds on second attempt", async () => {
			const eventCb = vi.fn();
			const b = new PiCodingAgentExecutionBackend({ onEvent: eventCb });

			let callCount = 0;
			mockPrompt.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					throw new Error(
						JSON.stringify({
							error: {
								type: "overloaded_error",
								message: "Overloaded",
							},
						}),
					);
				}
				// Second call succeeds
			});

			mockGetState.mockReturnValue({
				...mockState,
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: '{"artifacts":{}}' }],
						timestamp: Date.now(),
					},
				],
			});

			const resultPromise = b.runAgent(makeRequest());
			// Advance past the backoff sleep
			await vi.advanceTimersByTimeAsync(5000);
			const result = await resultPromise;

			// Should have retried — 2 calls total
			expect(callCount).toBe(2);
			// Should not have an error event (retry succeeded)
			const errorEvents = result.events.filter((e) => e.kind === "error");
			expect(errorEvents).toHaveLength(0);
			// Should have emitted a retry log event
			const retryLogs = (
				eventCb.mock.calls as Array<[{ content: string }]>
			).filter(([a]) => a.content.includes("[retry]"));
			expect(retryLogs.length).toBeGreaterThan(0);
		});

		it("gives up after max attempts and returns error event", async () => {
			const b = new PiCodingAgentExecutionBackend();
			mockPrompt.mockRejectedValue(
				new Error(
					JSON.stringify({
						error: {
							type: "overloaded_error",
							message: "Overloaded",
						},
					}),
				),
			);

			const resultPromise = b.runAgent(makeRequest());
			// Advance past all retry backoff sleeps (2s + 4s)
			await vi.advanceTimersByTimeAsync(10000);
			const result = await resultPromise;

			expect(result.events).toHaveLength(1);
			expect(result.events[0].kind).toBe("error");
		});

		it("does not retry on non-overloaded errors", async () => {
			const b = new PiCodingAgentExecutionBackend();
			let callCount = 0;
			mockPrompt.mockImplementation(async () => {
				callCount++;
				throw new Error("auth_failed: invalid API key");
			});

			const result = await b.runAgent(makeRequest());

			expect(callCount).toBe(1);
			expect(result.events[0].kind).toBe("error");
		});
	});
});

describe("stringifyToolPayload", () => {
	it("passes strings through unchanged", () => {
		expect(stringifyToolPayload("hello")).toBe("hello");
	});

	it("JSON-stringifies plain objects (no [object Object])", () => {
		const out = stringifyToolPayload({
			type: "text",
			text: "the result body",
		});
		expect(out).not.toBe("[object Object]");
		expect(JSON.parse(out)).toEqual({ type: "text", text: "the result body" });
	});

	it("JSON-stringifies arrays (e.g. Anthropic-style content blocks)", () => {
		const out = stringifyToolPayload([
			{ type: "text", text: "block 1" },
			{ type: "text", text: "block 2" },
		]);
		expect(out).not.toBe("[object Object]");
		expect(JSON.parse(out)).toHaveLength(2);
	});

	it("returns empty string for null / undefined", () => {
		expect(stringifyToolPayload(null)).toBe("");
		expect(stringifyToolPayload(undefined)).toBe("");
	});

	it("renders numbers and booleans as their string form", () => {
		expect(stringifyToolPayload(42)).toBe("42");
		expect(stringifyToolPayload(true)).toBe("true");
	});

	it("falls back to a marker for circular structures", () => {
		const a: Record<string, unknown> = {};
		a.self = a;
		expect(stringifyToolPayload(a)).toBe("[unserializable tool result]");
	});
});
