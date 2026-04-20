import { describe, expect, it } from "vitest";
import {
	type CapturedConversation,
	captureConversation,
	formatConversation,
} from "../../src/observability/conversation-capture.js";

describe("captureConversation", () => {
	it("should store messages in a conversation", () => {
		const conv = captureConversation({
			agentId: "analyst",
			runId: "run-001",
		});

		conv.addMessage({
			role: "user",
			content: "Analyze this brief",
			timestamp: Date.now(),
		});

		conv.addMessage({
			role: "assistant",
			content: "Here is my analysis",
			timestamp: Date.now(),
		});

		const captured = conv.finish();
		expect(captured.messages).toHaveLength(2);
		expect(captured.agentId).toBe("analyst");
		expect(captured.runId).toBe("run-001");
	});

	it("should capture tool call messages", () => {
		const conv = captureConversation({
			agentId: "developer",
			runId: "run-002",
		});

		conv.addMessage({
			role: "tool_call",
			content: '{"query": "SaaS market"}',
			toolName: "web_search",
			toolCallId: "tool_abc",
			timestamp: Date.now(),
		});

		conv.addMessage({
			role: "tool_result",
			content: '{"results": []}',
			toolCallId: "tool_abc",
			timestamp: Date.now(),
		});

		const captured = conv.finish();
		expect(captured.messages).toHaveLength(2);
		expect(captured.messages[0].toolName).toBe("web_search");
		expect(captured.messages[1].toolCallId).toBe("tool_abc");
	});

	it("should track token usage", () => {
		const conv = captureConversation({
			agentId: "analyst",
			runId: "run-003",
		});

		conv.setTokenUsage({ inputTokens: 2340, outputTokens: 12500 });
		const captured = conv.finish();

		expect(captured.tokenUsage.inputTokens).toBe(2340);
		expect(captured.tokenUsage.outputTokens).toBe(12500);
	});

	it("should track duration", () => {
		const conv = captureConversation({
			agentId: "analyst",
			runId: "run-004",
		});

		conv.setDuration(5432);
		const captured = conv.finish();

		expect(captured.durationMs).toBe(5432);
	});
});

describe("formatConversation", () => {
	it("should format user and assistant messages", () => {
		const conv: CapturedConversation = {
			agentId: "analyst",
			runId: "run-001",
			messages: [
				{ role: "user", content: "Analyze this brief", timestamp: 1000 },
				{ role: "assistant", content: "Here is my analysis", timestamp: 2000 },
			],
			tokenUsage: { inputTokens: 100, outputTokens: 200 },
			durationMs: 3000,
		};

		const output = formatConversation(conv);

		expect(output).toContain("[USER]");
		expect(output).toContain("Analyze this brief");
		expect(output).toContain("[ASSISTANT]");
		expect(output).toContain("Here is my analysis");
	});

	it("should format tool calls with name", () => {
		const conv: CapturedConversation = {
			agentId: "developer",
			runId: "run-002",
			messages: [
				{
					role: "tool_call",
					content: '{"query": "test"}',
					toolName: "web_search",
					toolCallId: "tool_1",
					timestamp: 1000,
				},
				{
					role: "tool_result",
					content: '{"results": []}',
					toolCallId: "tool_1",
					timestamp: 2000,
				},
			],
			tokenUsage: { inputTokens: 50, outputTokens: 100 },
			durationMs: 2000,
		};

		const output = formatConversation(conv);

		expect(output).toContain("[TOOL: web_search]");
		expect(output).toContain("[TOOL RESULT]");
	});

	it("should include token usage and duration summary", () => {
		const conv: CapturedConversation = {
			agentId: "analyst",
			runId: "run-003",
			messages: [],
			tokenUsage: { inputTokens: 2340, outputTokens: 12500 },
			durationMs: 45000,
		};

		const output = formatConversation(conv);

		expect(output).toContain("2340");
		expect(output).toContain("12500");
		expect(output).toContain("45");
	});

	it("should render readable output for empty conversations", () => {
		const conv: CapturedConversation = {
			agentId: "analyst",
			runId: "run-empty",
			messages: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 0,
		};

		const output = formatConversation(conv);
		expect(output).toBeDefined();
		expect(typeof output).toBe("string");
	});
});
