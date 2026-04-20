import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentRunner, createAgent } from "../../src/agents/runner.js";
import type { AppConfig } from "../../src/di/config.js";
import type { Container } from "../../src/di/container.js";
import type { SavedArtifact } from "../../src/domain/models/artifact.model.js";
import type { IArtifactStore } from "../../src/domain/ports/artifact-store.port.js";
import type {
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
import type { ILogger } from "../../src/domain/ports/logger.port.js";
import type { IPromptLoader } from "../../src/domain/ports/prompt-loader.port.js";

function createMockLogger(): ILogger {
	const logger: ILogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
	// child returns the same mock for simplicity
	(logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
	return logger;
}

function createMockContainer(overrides: Partial<Container> = {}): Container {
	const mockBackend: IExecutionBackend = {
		runAgent: vi.fn().mockResolvedValue({
			artifacts: [
				{ type: "spec", path: "frd.json", content: '{"title":"FRD"}' },
			],
			tokenUsage: { inputTokens: 500, outputTokens: 300 },
			durationMs: 1234,
			events: [],
		} satisfies AgentRunResult),
	};

	const mockStore: IArtifactStore = {
		save: vi.fn().mockResolvedValue({
			path: "frd.json",
			type: "spec",
			size: 100,
			createdAt: "2026-01-01T00:00:00.000Z",
			absolutePath: "/tmp/output/frd.json",
		} satisfies SavedArtifact),
		load: vi.fn().mockResolvedValue([]),
		list: vi.fn().mockResolvedValue([]),
	};

	const mockPromptLoader: IPromptLoader = {
		load: vi.fn().mockResolvedValue("You are an analyst agent."),
	};

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

	return {
		executionBackend: mockBackend,
		artifactStore: mockStore,
		promptLoader: mockPromptLoader,
		logger: createMockLogger(),
		config,
		...overrides,
	};
}

describe("createAgent", () => {
	it("returns an AgentRunner with a run() method", () => {
		const container = createMockContainer();
		const runner = createAgent("analyst", container);

		expect(runner).toBeDefined();
		expect(typeof runner.run).toBe("function");
	});

	it("throws for an unknown agent ID", () => {
		const container = createMockContainer();
		expect(() => createAgent("nonexistent-agent", container)).toThrow(
			/unknown agent/i,
		);
	});
});

describe("AgentRunner.run()", () => {
	let container: Container;
	let runner: AgentRunner;

	beforeEach(() => {
		container = createMockContainer();
		runner = createAgent("analyst", container);
	});

	it("calls prompt loader with agent ID", async () => {
		await runner.run({});

		expect(container.promptLoader.load).toHaveBeenCalledWith("analyst");
	});

	it("calls execution backend with system prompt and model config", async () => {
		await runner.run({});

		expect(container.executionBackend.runAgent).toHaveBeenCalledOnce();
		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.agentId).toBe("analyst");
		expect(call.systemPrompt).toBe("You are an analyst agent.");
		expect(call.model.provider).toBe("anthropic");
		expect(call.model.name).toBe("claude-sonnet-4-20250514");
	});

	it("passes inline string input as raw-brief artifact", async () => {
		await runner.run({ input: "Build a todo app with offline support" });

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.inputArtifacts).toHaveLength(1);
		expect(call.inputArtifacts[0].type).toBe("other");
		expect(call.inputArtifacts[0].content).toBe(
			"Build a todo app with offline support",
		);
	});

	it("passes additional user prompt as part of input artifacts", async () => {
		await runner.run({ prompt: "Focus on security requirements" });

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		const promptArtifact = call.inputArtifacts.find(
			(a) => a.type === ("prompt" as string),
		);
		expect(promptArtifact).toBeDefined();
		expect(promptArtifact?.content).toBe("Focus on security requirements");
	});

	it("saves each output artifact via artifact store", async () => {
		await runner.run({});

		expect(container.artifactStore.save).toHaveBeenCalledOnce();
		const [artifact, outputDir] = vi.mocked(container.artifactStore.save).mock
			.calls[0];
		expect(artifact.type).toBe("spec");
		expect(artifact.path).toBe("frd.json");
		expect(outputDir).toBe("/tmp/test-output");
	});

	it("uses override outputDir when provided", async () => {
		await runner.run({ outputDir: "/custom/output" });

		const [, outputDir] = vi.mocked(container.artifactStore.save).mock.calls[0];
		expect(outputDir).toBe("/custom/output");
	});

	it("returns AgentRunOutput with artifacts, tokenUsage, durationMs, savedFiles", async () => {
		const result = await runner.run({});

		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0].type).toBe("spec");
		expect(result.tokenUsage.inputTokens).toBe(500);
		expect(result.tokenUsage.outputTokens).toBe(300);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.savedFiles).toContain("/tmp/output/frd.json");
	});

	it("validates output artifacts against Zod schemas (logs warning, does not fail)", async () => {
		// Return an artifact with type "frd" that won't validate against the FRD schema
		vi.mocked(container.executionBackend.runAgent).mockResolvedValueOnce({
			artifacts: [
				{ type: "spec", path: "frd.json", content: "not valid json at all" },
			],
			tokenUsage: { inputTokens: 100, outputTokens: 50 },
			durationMs: 500,
			events: [],
		});

		// Should NOT throw — validation failures are warnings only
		const result = await runner.run({});
		expect(result.artifacts).toHaveLength(1);
	});

	it("handles multiple output artifacts", async () => {
		vi.mocked(container.executionBackend.runAgent).mockResolvedValueOnce({
			artifacts: [
				{ type: "spec", path: "frd.json", content: '{"title":"FRD"}' },
				{ type: "spec", path: "nfr.json", content: '{"title":"NFR"}' },
			],
			tokenUsage: { inputTokens: 1000, outputTokens: 800 },
			durationMs: 2000,
			events: [],
		});

		const result = await runner.run({});

		expect(result.artifacts).toHaveLength(2);
		expect(container.artifactStore.save).toHaveBeenCalledTimes(2);
		expect(result.savedFiles).toHaveLength(2);
	});
});

describe("tools and extensions forwarding", () => {
	let tmpDevforge: string;
	let savedDevforgeDir: string | undefined;

	beforeEach(() => {
		tmpDevforge = join(tmpdir(), `agentforge-tools-test-${Date.now()}`);
		mkdirSync(join(tmpDevforge, "agents"), { recursive: true });
		savedDevforgeDir = process.env.AGENTFORGE_DIR;
		process.env.AGENTFORGE_DIR = tmpDevforge;
	});

	afterEach(() => {
		rmSync(tmpDevforge, { recursive: true, force: true });
		if (savedDevforgeDir !== undefined) {
			process.env.AGENTFORGE_DIR = savedDevforgeDir;
		} else {
			delete process.env.AGENTFORGE_DIR;
		}
	});

	it("forwards tools list from agent YAML to AgentRunRequest", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  tools:
    - read
    - bash
    - grep
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.tools).toEqual(["read", "bash", "grep"]);
	});

	it("forwards extensions list from agent YAML to AgentRunRequest", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  extensions:
    - extensions/my-tool.ts
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.extensions).toEqual(["extensions/my-tool.ts"]);
	});

	it("does not include tools/extensions when YAML omits them", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.tools).toBeUndefined();
		expect(call.extensions).toBeUndefined();
	});
});

describe("inline systemPrompt.text", () => {
	let tmpDevforge: string;
	let savedDevforgeDir: string | undefined;

	beforeEach(() => {
		tmpDevforge = join(tmpdir(), `agentforge-inline-test-${Date.now()}`);
		mkdirSync(join(tmpDevforge, "agents"), { recursive: true });
		savedDevforgeDir = process.env.AGENTFORGE_DIR;
		process.env.AGENTFORGE_DIR = tmpDevforge;
	});

	afterEach(() => {
		rmSync(tmpDevforge, { recursive: true, force: true });
		if (savedDevforgeDir !== undefined) {
			process.env.AGENTFORGE_DIR = savedDevforgeDir;
		} else {
			delete process.env.AGENTFORGE_DIR;
		}
	});

	it("uses inline text prompt instead of calling promptLoader", async () => {
		const inlinePrompt = "You are a custom inline agent for testing.";
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "${inlinePrompt}"
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		// Prompt loader should NOT be called — inline text used directly
		expect(container.promptLoader.load).not.toHaveBeenCalled();

		// Backend should receive the inline text
		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.systemPrompt).toBe(inlinePrompt);
	});

	it("falls back to promptLoader when definition has file-based prompt", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		// Prompt loader SHOULD be called for file-based prompt
		expect(container.promptLoader.load).toHaveBeenCalledWith("analyst");
	});
});

describe("P38 — budget propagation from agent YAML", () => {
	let tmpDevforge: string;
	let savedDevforgeDir: string | undefined;

	beforeEach(() => {
		tmpDevforge = join(tmpdir(), `agentforge-budget-test-${Date.now()}`);
		mkdirSync(join(tmpDevforge, "agents"), { recursive: true });
		savedDevforgeDir = process.env.AGENTFORGE_DIR;
		process.env.AGENTFORGE_DIR = tmpDevforge;
	});

	afterEach(() => {
		rmSync(tmpDevforge, { recursive: true, force: true });
		if (savedDevforgeDir !== undefined) {
			process.env.AGENTFORGE_DIR = savedDevforgeDir;
		} else {
			delete process.env.AGENTFORGE_DIR;
		}
	});

	it("forwards budget from YAML resources to AgentRunRequest", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  outputs:
    - type: frd
  resources:
    budget:
      maxTotalTokens: 50000
      maxCostUsd: 0.15
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.budget).toEqual({ maxTotalTokens: 50000, maxCostUsd: 0.15 });
	});

	it("passes no budget when YAML has no resources block", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  outputs:
    - type: frd
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.budget).toBeUndefined();
	});

	it("passes no budget when YAML has resources but no budget field", async () => {
		writeFileSync(
			join(tmpDevforge, "agents", "analyst.agent.yaml"),
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a test agent."
  outputs:
    - type: frd
  resources: {}
`,
		);

		const container = createMockContainer();
		const runner = createAgent("analyst", container);
		await runner.run({});

		const call = vi.mocked(container.executionBackend.runAgent).mock
			.calls[0][0];
		expect(call.budget).toBeUndefined();
	});
});
