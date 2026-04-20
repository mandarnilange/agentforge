import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/**
 * Tests for the runner's loadInput / buildInputArtifacts logic.
 * We import the internal helpers indirectly by using the exported createAgent
 * with a mock container, then inspect what inputArtifacts reach the backend.
 */
import { createAgent } from "../../src/agents/runner.js";
import type { Container } from "../../src/di/container.js";
import type { ArtifactData } from "../../src/domain/models/artifact.model.js";
import type { IArtifactStore } from "../../src/domain/ports/artifact-store.port.js";
import type {
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
import type { ILogger } from "../../src/domain/ports/logger.port.js";
import type { IPromptLoader } from "../../src/domain/ports/prompt-loader.port.js";

let capturedArtifacts: ArtifactData[] = [];

function createMockLogger(): ILogger {
	const logger: ILogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis(),
	};
	(logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
	return logger;
}

function createTestContainer(): Container {
	capturedArtifacts = [];

	const mockBackend: IExecutionBackend = {
		runAgent: vi.fn().mockImplementation((req) => {
			capturedArtifacts = req.inputArtifacts;
			return Promise.resolve({
				artifacts: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				durationMs: 0,
				events: [],
			} satisfies AgentRunResult);
		}),
	};

	const mockStore: IArtifactStore = {
		save: vi.fn().mockResolvedValue({
			path: "x.json",
			type: "spec",
			size: 0,
			createdAt: "2026-01-01T00:00:00Z",
			absolutePath: "/tmp/x.json",
		}),
		load: vi.fn().mockResolvedValue([]),
		list: vi.fn().mockResolvedValue([]),
	};

	const mockPromptLoader: IPromptLoader = {
		load: vi.fn().mockResolvedValue("system prompt"),
	};

	return {
		executionBackend: mockBackend,
		artifactStore: mockStore,
		promptLoader: mockPromptLoader,
		logger: createMockLogger(),
		config: {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "test",
				maxTokens: 8192,
			},
			outputDir: "/tmp/test-output",
			promptsDir: "/tmp/test-prompts",
			logLevel: "info",
		},
	};
}

describe("Input loading from directory", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "input-loading-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("loads all JSON files from a directory with type derived from filename", async () => {
		const frdData = { title: "FRD Document", version: "1.0" };
		const nfrData = { scalability: "high", latency: "low" };

		await writeFile(
			join(tempDir, "frd.json"),
			JSON.stringify(frdData, null, 2),
		);
		await writeFile(
			join(tempDir, "nfr.json"),
			JSON.stringify(nfrData, null, 2),
		);
		await writeFile(
			join(tempDir, "_metadata.json"),
			JSON.stringify({ artifacts: [] }),
		);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: tempDir });

		expect(capturedArtifacts).toHaveLength(2);

		const frd = capturedArtifacts.find((a) => a.type === "frd");
		expect(frd).toBeDefined();
		expect(frd?.path).toBe("frd.json");
		// Content should be the raw JSON string, not parsed as ArtifactData
		expect(JSON.parse(frd?.content)).toEqual(frdData);

		const nfr = capturedArtifacts.find((a) => a.type === "nfr");
		expect(nfr).toBeDefined();
		expect(nfr?.path).toBe("nfr.json");
		expect(JSON.parse(nfr?.content)).toEqual(nfrData);
	});

	it("excludes _metadata.json from loaded artifacts", async () => {
		await writeFile(
			join(tempDir, "frd.json"),
			JSON.stringify({ title: "FRD" }),
		);
		await writeFile(
			join(tempDir, "_metadata.json"),
			JSON.stringify({ artifacts: [] }),
		);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: tempDir });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("frd");
	});

	it("derives type from filename without extension", async () => {
		await writeFile(
			join(tempDir, "tech-stack-recommendation.json"),
			JSON.stringify({ stack: "React" }),
		);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: tempDir });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("tech-stack-recommendation");
		expect(capturedArtifacts[0].path).toBe("tech-stack-recommendation.json");
	});

	it("stores raw file content as string in artifact content field", async () => {
		const rawData = { nested: { deep: [1, 2, 3] }, text: "hello" };
		const rawString = JSON.stringify(rawData, null, 2);
		await writeFile(join(tempDir, "design-tokens.json"), rawString);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: tempDir });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].content).toBe(rawString);
	});

	it("loads a single .md file as raw input", async () => {
		const mdPath = join(tempDir, "brief.md");
		await writeFile(mdPath, "# Project Brief\n\nBuild a todo app.");

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: mdPath });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("other");
		expect(capturedArtifacts[0].content).toBe(
			"# Project Brief\n\nBuild a todo app.",
		);
	});

	it("loads a mix of directory input and prompt", async () => {
		await writeFile(
			join(tempDir, "frd.json"),
			JSON.stringify({ title: "FRD" }),
		);
		await writeFile(
			join(tempDir, "_metadata.json"),
			JSON.stringify({ artifacts: [] }),
		);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: tempDir, prompt: "Focus on scalability" });

		// Should have directory artifacts + prompt artifact
		const frd = capturedArtifacts.find((a) => a.type === "frd");
		const prompt = capturedArtifacts.find((a) => a.type === "prompt");

		expect(frd).toBeDefined();
		expect(prompt).toBeDefined();
		expect(prompt?.content).toBe("Focus on scalability");
	});

	it("handles an empty directory gracefully (falls back to raw input)", async () => {
		const emptyDir = join(tempDir, "empty");
		await mkdir(emptyDir);

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: emptyDir });

		// Empty directory with no JSON files should fall back to treating path as raw input
		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("other");
	});

	it("loads a single JSON file with type derived from filename", async () => {
		const filePath = join(tempDir, "wireframes.json");
		await writeFile(filePath, JSON.stringify({ screens: ["home", "login"] }));

		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: filePath });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("wireframes");
		expect(capturedArtifacts[0].path).toBe("wireframes.json");
		expect(JSON.parse(capturedArtifacts[0].content)).toEqual({
			screens: ["home", "login"],
		});
	});

	it("falls back to raw input when JSON file cannot be read (ENOENT)", async () => {
		// Non-existent .json path → readFile throws → catch block line 259 covered
		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: "/nonexistent-path/missing-artifact.json" });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("other");
		expect(capturedArtifacts[0].content).toContain("missing-artifact.json");
	});

	it("falls back to raw input when markdown file cannot be read (ENOENT)", async () => {
		// Non-existent .md path → readFile throws → catch block line 268 covered
		const container = createTestContainer();
		const runner = createAgent("analyst", container);
		await runner.run({ input: "/nonexistent-path/spec.md" });

		expect(capturedArtifacts).toHaveLength(1);
		expect(capturedArtifacts[0].type).toBe("other");
		expect(capturedArtifacts[0].content).toContain("spec.md");
	});
});

describe("ensureNoExecutionFailure", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "exec-fail-test-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it("throws when backend returns error events (covers lines 210-216)", async () => {
		const container = createTestContainer();
		// Override mock to return error events
		vi.mocked(container.executionBackend.runAgent).mockResolvedValueOnce({
			artifacts: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 0,
			events: [{ kind: "error" as const, message: "LLM API failed" }],
		});

		const runner = createAgent("analyst", container);
		await expect(runner.run({})).rejects.toThrow("Agent execution failed");
	});

	it("throws with stringified event when event has no message property", async () => {
		const container = createTestContainer();
		vi.mocked(container.executionBackend.runAgent).mockResolvedValueOnce({
			artifacts: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			durationMs: 0,
			events: [{ kind: "error" as const }],
		});

		const runner = createAgent("analyst", container);
		await expect(runner.run({})).rejects.toThrow("Agent execution failed");
	});
});
