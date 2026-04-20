import { describe, expect, it } from "vitest";
import {
	endSpan,
	recordConversationEvents,
	startAgentRunSpan,
	startPipelineSpan,
	startStepSpan,
} from "../../src/observability/spans.js";

describe("startPipelineSpan", () => {
	it("should create a span with sdlc.pipeline attributes", () => {
		const span = startPipelineSpan({
			pipelineId: "pipe-001",
			pipelineName: "standard-sdlc",
			projectName: "invoicing-saas",
		});

		expect(span).toBeDefined();
		expect(span.end).toBeTypeOf("function");
		expect(span.setAttribute).toBeTypeOf("function");
		expect(span.setStatus).toBeTypeOf("function");
		span.end();
	});

	it("should handle missing optional projectName", () => {
		const span = startPipelineSpan({
			pipelineId: "pipe-002",
			pipelineName: "fast-track",
		});

		expect(span).toBeDefined();
		span.end();
	});
});

describe("startAgentRunSpan", () => {
	it("should create a span with sdlc.agent attributes", () => {
		const span = startAgentRunSpan({
			agentName: "analyst",
			runId: "run-001",
			phase: "1",
			executor: "pi-ai",
		});

		expect(span).toBeDefined();
		expect(span.end).toBeTypeOf("function");
		span.end();
	});

	it("should create a nested span under a parent", () => {
		const parent = startPipelineSpan({
			pipelineId: "pipe-003",
			pipelineName: "test",
		});
		const child = startAgentRunSpan(
			{
				agentName: "architect",
				runId: "run-002",
				phase: "2",
				executor: "pi-ai",
			},
			parent,
		);

		expect(child).toBeDefined();
		child.end();
		parent.end();
	});
});

describe("startStepSpan", () => {
	it("should create a span with step attributes", () => {
		const span = startStepSpan({
			stepName: "validate-inputs",
			stepType: "validate",
		});

		expect(span).toBeDefined();
		expect(span.end).toBeTypeOf("function");
		span.end();
	});

	it("should create a nested span under a parent agent span", () => {
		const agent = startAgentRunSpan({
			agentName: "analyst",
			runId: "run-003",
			phase: "1",
			executor: "pi-ai",
		});
		const step = startStepSpan(
			{ stepName: "generate", stepType: "llm" },
			agent,
		);

		expect(step).toBeDefined();
		step.end();
		agent.end();
	});
});

describe("recordConversationEvents", () => {
	it("should record conversation messages as span events without throwing", () => {
		const span = startAgentRunSpan({
			agentName: "analyst",
			runId: "run-conv-1",
			phase: "1",
			executor: "pi-ai",
		});

		const messages = [
			{ role: "user" as const, content: "Build a todo app", timestamp: 1000 },
			{
				role: "assistant" as const,
				content: "I will create a todo app.",
				timestamp: 2000,
			},
			{
				role: "tool_call" as const,
				content: '{"cmd": "mkdir"}',
				name: "bash",
				timestamp: 3000,
			},
			{
				role: "tool_result" as const,
				content: "OK",
				name: "bash",
				timestamp: 4000,
			},
		];

		expect(() => recordConversationEvents(span, messages)).not.toThrow();
		span.end();
	});

	it("should truncate long content to 4096 chars", () => {
		const span = startAgentRunSpan({
			agentName: "analyst",
			runId: "run-conv-2",
			phase: "1",
			executor: "pi-ai",
		});

		const longContent = "x".repeat(10000);
		expect(() =>
			recordConversationEvents(span, [
				{ role: "assistant" as const, content: longContent, timestamp: 1000 },
			]),
		).not.toThrow();
		span.end();
	});

	it("should handle empty message list", () => {
		const span = startAgentRunSpan({
			agentName: "analyst",
			runId: "run-conv-3",
			phase: "1",
			executor: "pi-ai",
		});

		expect(() => recordConversationEvents(span, [])).not.toThrow();
		span.end();
	});
});

describe("endSpan", () => {
	it("should end a span with ok status", () => {
		const span = startPipelineSpan({
			pipelineId: "pipe-004",
			pipelineName: "test",
		});

		expect(() => endSpan(span, "ok")).not.toThrow();
	});

	it("should end a span with error status and message", () => {
		const span = startPipelineSpan({
			pipelineId: "pipe-005",
			pipelineName: "test",
		});

		expect(() => endSpan(span, "error", "Something went wrong")).not.toThrow();
	});

	it("should end a span with error status without message", () => {
		const span = startPipelineSpan({
			pipelineId: "pipe-006",
			pipelineName: "test",
		});

		expect(() => endSpan(span, "error")).not.toThrow();
	});
});
