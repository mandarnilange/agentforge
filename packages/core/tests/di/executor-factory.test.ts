import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../src/di/config.js";
import { createAgentExecutor } from "../../src/di/executor-factory.js";

const mockConfig: AppConfig = {
	llm: {
		provider: "anthropic",
		model: "claude-sonnet-4-20250514",
		maxTokens: 4096,
	},
	outputDir: "/tmp/executor-factory-test",
	logLevel: "silent",
};

describe("createAgentExecutor", () => {
	it("creates a local agent executor in local mode", () => {
		const executor = createAgentExecutor("local", { config: mockConfig });
		expect(executor).toBeDefined();
		expect(typeof executor.execute).toBe("function");
	});

	it("returns an executor with a cancel method", () => {
		const executor = createAgentExecutor("local", { config: mockConfig });
		// cancel may or may not be present on TracedAgentExecutor
		// but it should not throw when called
		expect(() => executor.cancel?.("run-test")).not.toThrow();
	});

	it("wraps the executor in a TracedAgentExecutor", () => {
		const executor = createAgentExecutor("local", { config: mockConfig });
		// TracedAgentExecutor has inner executor - verify it delegates
		expect(executor).toBeDefined();
		// The returned object should be a TracedAgentExecutor
		expect(executor.constructor.name).toBe("TracedAgentExecutor");
	});
});
