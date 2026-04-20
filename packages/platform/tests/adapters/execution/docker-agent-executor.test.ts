import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type {
	AgentJob,
	StatusUpdate,
} from "agentforge-core/domain/ports/agent-executor.port.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockerAgentExecutor } from "../../../src/adapters/execution/docker-agent-executor.js";

function makeJob(overrides?: Partial<AgentJob>): AgentJob {
	return {
		runId: "run-docker-001",
		agentId: "developer",
		agentDefinition: {
			metadata: { name: "developer" },
			spec: { executor: "pi-coding-agent" },
		},
		inputs: [{ type: "spec", path: "arch.json", content: '{"components":[]}' }],
		workdir: join(tmpdir(), `docker-test-work-${Date.now()}`),
		outputDir: join(tmpdir(), `docker-test-out-${Date.now()}`),
		model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 64000 },
		...overrides,
	};
}

function createMockDocker(opts?: {
	exitCode?: number;
	stdout?: string;
	resultJson?: unknown;
}) {
	const exitCode = opts?.exitCode ?? 0;
	const stdout =
		opts?.stdout ??
		'{"type":"started","runId":"run-docker-001","timestamp":1234}\n{"type":"completed","runId":"run-docker-001","timestamp":1235}\n';

	const mockContainer = {
		id: "container-abc",
		start: vi.fn().mockResolvedValue(undefined),
		logs: vi.fn().mockResolvedValue(Readable.from([Buffer.from(stdout)])),
		wait: vi.fn().mockResolvedValue({ StatusCode: exitCode }),
		remove: vi.fn().mockResolvedValue(undefined),
	};

	return {
		docker: {
			createContainer: vi.fn().mockResolvedValue(mockContainer),
			listContainers: vi.fn().mockResolvedValue([]),
		},
		container: mockContainer,
		resultJson: opts?.resultJson ?? {
			artifacts: [{ type: "code", path: "api.json", content: "{}" }],
			savedFiles: ["/output/api.json"],
			tokenUsage: { inputTokens: 3000, outputTokens: 5000 },
			costUsd: 0.09,
			conversationLog: [],
		},
	};
}

describe("DockerAgentExecutor (P18-T8)", () => {
	let workdir: string;
	let outputDir: string;

	beforeEach(() => {
		workdir = join(tmpdir(), `docker-test-work-${Date.now()}`);
		outputDir = join(tmpdir(), `docker-test-out-${Date.now()}`);
		mkdirSync(workdir, { recursive: true });
		mkdirSync(outputDir, { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(workdir, { recursive: true, force: true });
			rmSync(outputDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("creates container with correct config and returns result", async () => {
		const { docker, container, resultJson } = createMockDocker();

		// Write mock _result.json to outputDir
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		expect(docker.createContainer).toHaveBeenCalledOnce();
		const createArgs = docker.createContainer.mock.calls[0][0];
		expect(createArgs.Image).toBe("sdlc-executor:latest");
		expect(createArgs.Env).toContain("AGENT_ID=developer");
		expect(createArgs.Env).toContain("RUN_ID=run-docker-001");

		expect(container.start).toHaveBeenCalledOnce();
		expect(container.wait).toHaveBeenCalledOnce();
		expect(container.remove).toHaveBeenCalledOnce();

		expect(result.status).toBe("succeeded");
		expect(result.artifacts).toHaveLength(1);
		expect(result.tokenUsage.inputTokens).toBe(3000);
	});

	it("returns failed status on non-zero exit code", async () => {
		const { docker } = createMockDocker({ exitCode: 1 });

		writeFileSync(
			join(outputDir, "_result.json"),
			JSON.stringify({
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				costUsd: 0,
				conversationLog: [],
			}),
		);

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("exit code 1");
	});

	it("streams status updates from container stdout", async () => {
		const stdout = `${[
			'{"type":"started","runId":"run-docker-001","timestamp":1000}',
			'{"type":"progress","runId":"run-docker-001","message":"Working...","timestamp":1001}',
			'{"type":"completed","runId":"run-docker-001","timestamp":1002}',
		].join("\n")}\n`;

		const { docker, resultJson } = createMockDocker({ stdout });
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const updates: StatusUpdate[] = [];
		const job = makeJob({ workdir, outputDir });
		await executor.execute(job, (update) => updates.push(update));

		// Should have at least the started and completed from stdout parsing
		expect(updates.length).toBeGreaterThanOrEqual(2);
		expect(updates[0].type).toBe("started");
	});

	it("handles missing _result.json gracefully", async () => {
		const { docker } = createMockDocker();
		// Don't write _result.json

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		// Should still succeed but with empty artifacts
		expect(result.artifacts).toEqual([]);
	});

	it("mounts agentforge dir as read-only when AGENTFORGE_DIR is set", async () => {
		const savedDir = process.env.AGENTFORGE_DIR;
		process.env.AGENTFORGE_DIR = "/my/custom/agentforge";
		try {
			const { docker, resultJson } = createMockDocker();
			writeFileSync(
				join(outputDir, "_result.json"),
				JSON.stringify(resultJson),
			);

			const executor = new DockerAgentExecutor({
				docker: docker as unknown as DockerAgentExecutor extends {
					docker: infer D;
				}
					? D
					: never,
				defaultImage: "sdlc-executor:latest",
			});

			const job = makeJob({ workdir, outputDir });
			await executor.execute(job);

			const createArgs = docker.createContainer.mock.calls[0][0];
			const binds = createArgs.HostConfig.Binds as string[];
			expect(binds).toContainEqual("/my/custom/agentforge:/agentforge:ro");
		} finally {
			if (savedDir !== undefined) {
				process.env.AGENTFORGE_DIR = savedDir;
			} else {
				delete process.env.AGENTFORGE_DIR;
			}
		}
	});

	it("mounts default .agentforge dir when AGENTFORGE_DIR is not set", async () => {
		const savedDir = process.env.AGENTFORGE_DIR;
		delete process.env.AGENTFORGE_DIR;
		try {
			const { docker, resultJson } = createMockDocker();
			writeFileSync(
				join(outputDir, "_result.json"),
				JSON.stringify(resultJson),
			);

			const executor = new DockerAgentExecutor({
				docker: docker as unknown as DockerAgentExecutor extends {
					docker: infer D;
				}
					? D
					: never,
				defaultImage: "sdlc-executor:latest",
			});

			const job = makeJob({ workdir, outputDir });
			await executor.execute(job);

			const createArgs = docker.createContainer.mock.calls[0][0];
			const binds = createArgs.HostConfig.Binds as string[];
			const devforgeBind = binds.find((b: string) =>
				b.includes("/agentforge:ro"),
			);
			expect(devforgeBind).toBeDefined();
			expect(devforgeBind).toContain(".agentforge:/agentforge:ro");
		} finally {
			if (savedDir !== undefined) {
				process.env.AGENTFORGE_DIR = savedDir;
			} else {
				delete process.env.AGENTFORGE_DIR;
			}
		}
	});

	it("returns failed status when Docker throws", async () => {
		const docker = {
			createContainer: vi
				.fn()
				.mockRejectedValue(new Error("Docker daemon unreachable")),
			listContainers: vi.fn().mockResolvedValue([]),
		};

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("Docker daemon unreachable");
		expect(result.artifacts).toEqual([]);
		expect(result.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
	});

	it("cancel removes containers matching the run label", async () => {
		const remove1 = vi.fn().mockResolvedValue(undefined);
		const remove2 = vi.fn().mockResolvedValue(undefined);
		const docker = {
			createContainer: vi.fn(),
			listContainers: vi
				.fn()
				.mockResolvedValue([{ remove: remove1 }, { remove: remove2 }]),
		};

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		await executor.cancel("run-cancel-42");

		expect(docker.listContainers).toHaveBeenCalledOnce();
		const args = docker.listContainers.mock.calls[0][0];
		const filters = JSON.parse(args.filters as string) as {
			label?: string[];
		};
		expect(filters.label).toContain("agentforge.run-id=run-cancel-42");
		expect(remove1).toHaveBeenCalledWith({ force: true });
		expect(remove2).toHaveBeenCalledWith({ force: true });
	});

	it("cancel swallows per-container remove errors (best-effort)", async () => {
		const docker = {
			createContainer: vi.fn(),
			listContainers: vi
				.fn()
				.mockResolvedValue([
					{ remove: vi.fn().mockRejectedValue(new Error("already gone")) },
				]),
		};
		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});
		// Should not throw
		await expect(executor.cancel("any-run")).resolves.toBeUndefined();
	});

	it("parses memory with megabyte unit (m)", async () => {
		const { docker, resultJson } = createMockDocker();
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({
			workdir,
			outputDir,
			agentDefinition: {
				metadata: { name: "developer" },
				spec: { executor: "pi-coding-agent", sandbox: { memory: "512m" } },
			},
		});
		await executor.execute(job);
		const createArgs = docker.createContainer.mock.calls[0][0];
		expect(createArgs.HostConfig.Memory).toBe(512 * 1024 * 1024);
	});

	it("parses memory with kilobyte unit (k)", async () => {
		const { docker, resultJson } = createMockDocker();
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({
			workdir,
			outputDir,
			agentDefinition: {
				metadata: { name: "developer" },
				spec: { executor: "pi-coding-agent", sandbox: { memory: "2048k" } },
			},
		});
		await executor.execute(job);
		const createArgs = docker.createContainer.mock.calls[0][0];
		expect(createArgs.HostConfig.Memory).toBe(2048 * 1024);
	});

	it("leaves memory unset when sandbox.memory has invalid format", async () => {
		const { docker, resultJson } = createMockDocker();
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({
			workdir,
			outputDir,
			agentDefinition: {
				metadata: { name: "developer" },
				spec: { executor: "pi-coding-agent", sandbox: { memory: "bogus" } },
			},
		});
		await executor.execute(job);
		const createArgs = docker.createContainer.mock.calls[0][0];
		expect(createArgs.HostConfig.Memory).toBeUndefined();
	});

	it("sets resource limits from agent definition", async () => {
		const { docker, resultJson } = createMockDocker();
		writeFileSync(join(outputDir, "_result.json"), JSON.stringify(resultJson));

		const executor = new DockerAgentExecutor({
			docker: docker as unknown as DockerAgentExecutor extends {
				docker: infer D;
			}
				? D
				: never,
			defaultImage: "sdlc-executor:latest",
		});

		const job = makeJob({
			workdir,
			outputDir,
			agentDefinition: {
				metadata: { name: "developer" },
				spec: {
					executor: "pi-coding-agent",
					sandbox: { memory: "1g" },
				},
			},
		});
		await executor.execute(job);

		const createArgs = docker.createContainer.mock.calls[0][0];
		expect(createArgs.HostConfig.Memory).toBe(1024 * 1024 * 1024);
	});
});
