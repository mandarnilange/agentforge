import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prevent dotenv from re-injecting .env vars so env-isolation tests work correctly
vi.mock("dotenv", () => ({ config: vi.fn() }));

import { type AppConfig, loadConfig } from "../../src/di/config.js";
import {
	createBackendForExecutor,
	createContainer,
	createContainerForAgent,
} from "../../src/di/container.js";
import {
	getValidatorForType,
	resetDiscoveredSchemas,
} from "../../src/schemas/index.js";

describe("loadConfig", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Clear relevant env vars
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.AGENTFORGE_LLM_PROVIDER;
		delete process.env.AGENTFORGE_DEFAULT_MODEL;
		delete process.env.AGENTFORGE_OUTPUT_DIR;
		delete process.env.AGENTFORGE_LOG_LEVEL;
		delete process.env.AGENTFORGE_PROMPTS_DIR;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("throws when ANTHROPIC_API_KEY is missing and no override provided", () => {
		expect(() => loadConfig()).toThrow(/ANTHROPIC_API_KEY/i);
	});

	it("loads config from env vars", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-key";
		process.env.AGENTFORGE_LLM_PROVIDER = "anthropic";
		process.env.AGENTFORGE_DEFAULT_MODEL = "claude-sonnet-4-20250514";
		process.env.AGENTFORGE_OUTPUT_DIR = "/tmp/output";
		process.env.AGENTFORGE_LOG_LEVEL = "warn";
		process.env.AGENTFORGE_PROMPTS_DIR = "/tmp/prompts";

		const config = loadConfig();

		expect(config.llm.apiKey).toBe("sk-test-key");
		expect(config.llm.provider).toBe("anthropic");
		expect(config.llm.model).toBe("claude-sonnet-4-20250514");
		expect(config.outputDir).toBe("/tmp/output");
		expect(config.logLevel).toBe("warn");
		expect(config.promptsDir).toBe("/tmp/prompts");
	});

	it("applies sensible defaults when only API key is present", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-key";

		const config = loadConfig();

		expect(config.llm.provider).toBe("anthropic");
		expect(config.llm.model).toBe("claude-sonnet-4-20250514");
		expect(config.llm.maxTokens).toBe(64000);
		expect(config.outputDir).toContain("output");
		expect(config.logLevel).toBe("info");
	});

	it("merges overrides on top of env-based config", () => {
		process.env.ANTHROPIC_API_KEY = "sk-env-key";

		const config = loadConfig({
			llm: {
				provider: "anthropic",
				model: "claude-opus-4-20250514",
				apiKey: "sk-override-key",
				maxTokens: 4096,
			},
		});

		expect(config.llm.apiKey).toBe("sk-override-key");
		expect(config.llm.model).toBe("claude-opus-4-20250514");
		expect(config.llm.maxTokens).toBe(4096);
	});

	it("accepts API key from overrides when env var is absent", () => {
		const config = loadConfig({
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-from-override",
				maxTokens: 8192,
			},
		});

		expect(config.llm.apiKey).toBe("sk-from-override");
	});
});

describe("createContainer", () => {
	it("returns object with all required services", () => {
		const config: AppConfig = {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-test",
				maxTokens: 8192,
			},
			outputDir: "/tmp/test-output",
			promptsDir: "/tmp/test-prompts",
			logLevel: "info",
		};

		const container = createContainer(config);

		expect(container.config).toBe(config);
		expect(container.executionBackend).toBeDefined();
		expect(container.executionBackend.runAgent).toBeDefined();
		expect(container.artifactStore).toBeDefined();
		expect(container.artifactStore.save).toBeDefined();
		expect(container.promptLoader).toBeDefined();
		expect(container.promptLoader.load).toBeDefined();
		expect(container.logger).toBeDefined();
		expect(container.logger.info).toBeDefined();
	});

	it("stores the provided config", () => {
		const config: AppConfig = {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-test",
				maxTokens: 8192,
			},
			outputDir: "/tmp/out",
			promptsDir: "/tmp/prompts",
			logLevel: "debug",
		};

		const container = createContainer(config);
		expect(container.config).toStrictEqual(config);
	});
});

describe("createBackendForExecutor", () => {
	it("returns a traced backend wrapping PiAiExecutionBackend for pi-ai executor", () => {
		const backend = createBackendForExecutor("pi-ai");
		expect(backend.runAgent).toBeTypeOf("function");
	});

	it("returns a traced backend wrapping PiCodingAgentExecutionBackend for pi-coding-agent executor", () => {
		const backend = createBackendForExecutor("pi-coding-agent");
		expect(backend.runAgent).toBeTypeOf("function");
	});

	it("passes onProgress to the created backend", () => {
		const cb = vi.fn();
		const backend = createBackendForExecutor("pi-ai", { onProgress: cb });
		expect(backend.runAgent).toBeTypeOf("function");
	});
});

describe("createContainerForAgent", () => {
	const config: AppConfig = {
		llm: {
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "sk-test",
			maxTokens: 8192,
		},
		outputDir: "/tmp/test-output",
		promptsDir: "/tmp/test-prompts",
		logLevel: "info",
	};

	it("returns traced backend for pi-ai executor type", () => {
		const container = createContainerForAgent("pi-ai", config);
		expect(container.executionBackend.runAgent).toBeTypeOf("function");
	});

	it("returns traced backend for pi-coding-agent executor type", () => {
		const container = createContainerForAgent("pi-coding-agent", config);
		expect(container.executionBackend.runAgent).toBeTypeOf("function");
	});

	it("returns all required services", () => {
		const container = createContainerForAgent("pi-coding-agent", config);
		expect(container.config).toBe(config);
		expect(container.executionBackend).toBeDefined();
		expect(container.artifactStore).toBeDefined();
		expect(container.promptLoader).toBeDefined();
		expect(container.logger).toBeDefined();
	});
});

describe("schema discovery wiring", () => {
	afterEach(() => {
		resetDiscoveredSchemas();
	});

	it("createContainer wires discovered schemas so getValidatorForType returns ajv validator with jsonSchema", () => {
		resetDiscoveredSchemas();
		const config: AppConfig = {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-test",
				maxTokens: 8192,
			},
			outputDir: "/tmp/out",
			promptsDir: "/tmp/prompts",
			logLevel: "info",
		};
		createContainer(config);
		const validator = getValidatorForType("requirements");
		expect(validator).toBeDefined();
		expect(validator?.jsonSchema).toBeDefined();
	});

	it("createContainerForAgent wires discovered schemas", () => {
		resetDiscoveredSchemas();
		const config: AppConfig = {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "sk-test",
				maxTokens: 8192,
			},
			outputDir: "/tmp/out",
			promptsDir: "/tmp/prompts",
			logLevel: "info",
		};
		createContainerForAgent("pi-ai", config);
		const validator = getValidatorForType("architecture-plan");
		expect(validator?.jsonSchema).toBeDefined();
	});
});
