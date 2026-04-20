import { describe, expect, it } from "vitest";
import { createMetricsRecorder } from "../../src/observability/metrics.js";

describe("createMetricsRecorder", () => {
	it("should return an object implementing AgentMetrics", () => {
		const metrics = createMetricsRecorder();

		expect(metrics).toBeDefined();
		expect(metrics.recordAgentRun).toBeTypeOf("function");
		expect(metrics.recordToolCall).toBeTypeOf("function");
	});

	it("should not throw when recording an agent run", () => {
		const metrics = createMetricsRecorder();

		expect(() =>
			metrics.recordAgentRun(
				"analyst",
				5000,
				{ input: 2340, output: 12500 },
				"success",
			),
		).not.toThrow();
	});

	it("should not throw when recording a failed agent run", () => {
		const metrics = createMetricsRecorder();

		expect(() =>
			metrics.recordAgentRun(
				"architect",
				3000,
				{ input: 100, output: 0 },
				"error",
			),
		).not.toThrow();
	});

	it("should not throw when recording a tool call", () => {
		const metrics = createMetricsRecorder();

		expect(() =>
			metrics.recordToolCall("developer", "web_search", 2100),
		).not.toThrow();
	});

	it("should not throw when recording multiple metrics in sequence", () => {
		const metrics = createMetricsRecorder();

		expect(() => {
			metrics.recordAgentRun(
				"analyst",
				5000,
				{ input: 100, output: 200 },
				"success",
			);
			metrics.recordToolCall("analyst", "read_file", 50);
			metrics.recordToolCall("analyst", "write_file", 30);
			metrics.recordAgentRun(
				"architect",
				8000,
				{ input: 500, output: 1000 },
				"success",
			);
		}).not.toThrow();
	});

	it("should expose recordNodeHeartbeat method", () => {
		const m = createMetricsRecorder();
		expect(m.recordNodeHeartbeat).toBeTypeOf("function");
	});

	it("should not throw when recording a node heartbeat", () => {
		const m = createMetricsRecorder();
		expect(() => m.recordNodeHeartbeat("local", "online")).not.toThrow();
		expect(() => m.recordNodeHeartbeat("remote", "offline")).not.toThrow();
	});

	it("should expose recordNodeActiveRuns method", () => {
		const m = createMetricsRecorder();
		expect(m.recordNodeActiveRuns).toBeTypeOf("function");
	});

	it("should not throw when recording node active runs", () => {
		const m = createMetricsRecorder();
		expect(() => m.recordNodeActiveRuns("local", 3)).not.toThrow();
	});

	it("should expose recordRunCost method", () => {
		const m = createMetricsRecorder();
		expect(m.recordRunCost).toBeTypeOf("function");
	});

	it("should not throw when recording run cost", () => {
		const m = createMetricsRecorder();
		expect(() =>
			m.recordRunCost(
				"analyst",
				"anthropic",
				"claude-sonnet-4-20250514",
				0.0075,
			),
		).not.toThrow();
	});
});
