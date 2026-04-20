import { describe, expect, it } from "vitest";
import type { IArtifactStore } from "../../src/domain/ports/artifact-store.port.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
// Verify barrel re-exports
import type {
	IExecutionBackend as ReExportedBackend,
	IPromptLoader as ReExportedLoader,
	ILogger as ReExportedLogger,
	ISandboxProvider as ReExportedSandboxProvider,
	IArtifactStore as ReExportedStore,
} from "../../src/domain/ports/index.js";
import type { ILogger } from "../../src/domain/ports/logger.port.js";
import type { IPromptLoader } from "../../src/domain/ports/prompt-loader.port.js";
import type {
	ISandbox,
	ISandboxProvider,
	RunOptions,
	SandboxOptions,
} from "../../src/domain/ports/sandbox.port.js";

describe("domain/ports", () => {
	describe("IExecutionBackend", () => {
		it("should be implementable", () => {
			const backend: IExecutionBackend = {
				runAgent: async (
					_request: AgentRunRequest,
				): Promise<AgentRunResult> => ({
					artifacts: [],
					tokenUsage: { inputTokens: 100, outputTokens: 200 },
					durationMs: 1500,
					events: [],
				}),
			};
			expect(backend.runAgent).toBeDefined();
		});

		it("should accept a full request and return a result", async () => {
			const backend: IExecutionBackend = {
				runAgent: async (_request) => ({
					artifacts: [{ type: "code", path: "out.ts", content: "done" }],
					tokenUsage: { inputTokens: 50, outputTokens: 150 },
					durationMs: 800,
					events: [
						{ kind: "thinking", timestamp: Date.now(), content: "working" },
					],
				}),
			};

			const request: AgentRunRequest = {
				agentId: "coder",
				systemPrompt: "You are a coder.",
				inputArtifacts: [{ type: "spec", path: "spec.md", content: "Build X" }],
				model: {
					provider: "anthropic",
					name: "claude-sonnet",
					maxTokens: 4096,
				},
				tools: ["file_write"],
			};

			const result = await backend.runAgent(request);
			expect(result.artifacts).toHaveLength(1);
			expect(result.tokenUsage.inputTokens).toBe(50);
			expect(result.durationMs).toBe(800);
			expect(result.events).toHaveLength(1);
		});

		it("should support AbortSignal in request", () => {
			const controller = new AbortController();
			const request: AgentRunRequest = {
				agentId: "test",
				systemPrompt: "test",
				inputArtifacts: [],
				model: {
					provider: "anthropic",
					name: "claude-sonnet",
					maxTokens: 4096,
				},
				signal: controller.signal,
			};
			expect(request.signal).toBeDefined();
		});
	});

	describe("IArtifactStore", () => {
		it("should be implementable", () => {
			const store: IArtifactStore = {
				save: async (artifact, outputDir) => ({
					path: artifact.path,
					type: artifact.type,
					size: artifact.content.length,
					createdAt: new Date().toISOString(),
					absolutePath: `${outputDir}/${artifact.path}`,
				}),
				load: async (_query) => [],
				list: async (_dir) => [],
			};
			expect(store.save).toBeDefined();
			expect(store.load).toBeDefined();
			expect(store.list).toBeDefined();
		});

		it("should save and return SavedArtifact", async () => {
			const store: IArtifactStore = {
				save: async (artifact, outputDir) => ({
					path: artifact.path,
					type: artifact.type,
					size: artifact.content.length,
					createdAt: new Date().toISOString(),
					absolutePath: `${outputDir}/${artifact.path}`,
				}),
				load: async () => [],
				list: async () => [],
			};

			const result = await store.save(
				{ type: "code", path: "index.ts", content: "hello" },
				"/output",
			);
			expect(result.absolutePath).toBe("/output/index.ts");
			expect(result.size).toBe(5);
		});
	});

	describe("IPromptLoader", () => {
		it("should be implementable", () => {
			const loader: IPromptLoader = {
				load: async (agentId: string) => `You are ${agentId}`,
			};
			expect(loader.load).toBeDefined();
		});

		it("should load a prompt by agentId", async () => {
			const loader: IPromptLoader = {
				load: async (agentId) => `System prompt for ${agentId}`,
			};
			const prompt = await loader.load("spec-writer");
			expect(prompt).toBe("System prompt for spec-writer");
		});
	});

	describe("ILogger", () => {
		it("should be implementable with all log levels and child()", () => {
			const logs: string[] = [];
			const createLogger = (prefix: string): ILogger => ({
				debug: (_ctx, msg) => logs.push(`${prefix}:debug:${msg}`),
				info: (_ctx, msg) => logs.push(`${prefix}:info:${msg}`),
				warn: (_ctx, msg) => logs.push(`${prefix}:warn:${msg}`),
				error: (_ctx, msg) => logs.push(`${prefix}:error:${msg}`),
				child: (bindings) =>
					createLogger(`${prefix}:${JSON.stringify(bindings)}`),
			});

			const logger = createLogger("root");
			logger.debug({ op: "test" }, "debug msg");
			logger.info({ op: "test" }, "info msg");
			logger.warn({ op: "test" }, "warn msg");
			logger.error({ op: "test" }, "error msg");

			const child = logger.child({ agentId: "coder" });
			child.info({}, "child msg");

			expect(logs).toHaveLength(5);
			expect(logs[0]).toBe("root:debug:debug msg");
			expect(logs[4]).toContain("child msg");
		});
	});

	describe("ISandboxProvider / ISandbox", () => {
		it("should be implementable", async () => {
			const sandbox: ISandbox = {
				run: async (_command, _options?) => ({
					exitCode: 0,
					stdout: "output",
					stderr: "",
				}),
				writeFile: async (_path, _content) => {},
				readFile: async (_path) => "file content",
				copyIn: async (_localPath, _sandboxPath) => {},
				copyOut: async (_sandboxPath, _localPath) => {},
				destroy: async () => {},
			};

			const provider: ISandboxProvider = {
				create: async (_options) => sandbox,
			};

			const created = await provider.create({ image: "node:20" });
			const result = await created.run("echo hello");
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("output");

			await created.writeFile("/app/index.ts", "code");
			const content = await created.readFile("/app/index.ts");
			expect(content).toBe("file content");

			await created.copyIn("/local/file", "/sandbox/file");
			await created.copyOut("/sandbox/file", "/local/file");
			await created.destroy();
		});

		it("should accept sandbox options", async () => {
			const options: SandboxOptions = {
				image: "node:20-slim",
				memory: "512m",
				timeout: 60000,
			};
			expect(options.image).toBe("node:20-slim");
		});

		it("should accept run options", async () => {
			const sandbox: ISandbox = {
				run: async (_command, _options?) => ({
					exitCode: 0,
					stdout: "",
					stderr: "",
				}),
				writeFile: async () => {},
				readFile: async () => "",
				copyIn: async () => {},
				copyOut: async () => {},
				destroy: async () => {},
			};

			const runOpts: RunOptions = {
				cwd: "/app",
				timeout: 30000,
				env: { NODE_ENV: "test" },
			};
			const result = await sandbox.run("npm test", runOpts);
			expect(result.exitCode).toBe(0);
		});
	});

	describe("barrel re-exports", () => {
		it("should re-export all ports from index", () => {
			// Type-level checks: if this compiles, re-exports work
			const backend: ReExportedBackend = {
				runAgent: async () => ({
					artifacts: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					durationMs: 0,
					events: [],
				}),
			};
			const store: ReExportedStore = {
				save: async (a, _d) => ({
					path: a.path,
					type: a.type,
					size: 0,
					createdAt: "",
					absolutePath: "",
				}),
				load: async () => [],
				list: async () => [],
			};
			const loader: ReExportedLoader = { load: async () => "" };
			const logger: ReExportedLogger = {
				debug: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
				child: () => logger,
			};
			const provider: ReExportedSandboxProvider = {
				create: async () => ({
					run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
					writeFile: async () => {},
					readFile: async () => "",
					copyIn: async () => {},
					copyOut: async () => {},
					destroy: async () => {},
				}),
			};

			expect(backend).toBeDefined();
			expect(store).toBeDefined();
			expect(loader).toBeDefined();
			expect(logger).toBeDefined();
			expect(provider).toBeDefined();
		});
	});
});
