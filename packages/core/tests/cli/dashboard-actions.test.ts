/**
 * Tests for the dashboard CLI command — server startup and registration.
 */

import type { Server } from "node:http";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateDashboardServer, mockExecutePipeline } = vi.hoisted(() => ({
	mockCreateDashboardServer: vi.fn(),
	mockExecutePipeline: vi.fn().mockResolvedValue({ pausedAtGate: false }),
}));

vi.mock("../../src/dashboard/server.js", () => ({
	createDashboardServer: mockCreateDashboardServer,
}));

vi.mock("../../src/cli/pipeline-executor.js", () => ({
	executePipeline: mockExecutePipeline,
}));

import { registerDashboardCommand } from "../../src/cli/commands/dashboard.js";
import type { GateController } from "../../src/control-plane/gate-controller.js";
import type { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import type { AppConfig } from "../../src/di/config.js";
import type { IAgentExecutor } from "../../src/domain/ports/agent-executor.port.js";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";

function makeMockAgentExecutor(): IAgentExecutor {
	return {
		execute: vi.fn().mockResolvedValue({
			status: "succeeded",
			artifacts: [],
			savedFiles: [],
			tokenUsage: { inputTokens: 0, outputTokens: 0 },
			costUsd: 0,
			durationMs: 0,
			conversationLog: [],
		}),
		cancel: vi.fn().mockResolvedValue(undefined),
	};
}

function makeMockGateController(): GateController {
	return {
		approve: vi.fn(),
		reject: vi.fn(),
		requestRevision: vi.fn(),
	} as unknown as GateController;
}

function makeMockStore(): IStateStore {
	return {
		getGate: vi.fn(),
		getPipelineRun: vi.fn(),
		updatePipelineRun: vi.fn(),
		listAgentRuns: vi.fn(),
		getPendingGate: vi.fn(),
		createPipelineRun: vi.fn(),
		createAgentRun: vi.fn(),
		getAgentRun: vi.fn(),
		listPipelineRuns: vi.fn(),
		updateAgentRun: vi.fn(),
		createGate: vi.fn(),
		listGates: vi.fn(),
		updateGate: vi.fn(),
		upsertNode: vi.fn(),
		getNode: vi.fn(),
		listNodes: vi.fn(),
		writeAuditLog: vi.fn(),
		listAuditLog: vi.fn(),
		getConversationLog: vi.fn(),
		saveConversationLog: vi.fn(),
		writeExecutionLog: vi.fn(),
		listExecutionLogs: vi.fn(),
		close: vi.fn(),
	} as unknown as IStateStore;
}

function makeMockServer(onListen?: () => void): Server {
	const mockServer = {
		listen: vi
			.fn()
			.mockImplementation((_port: number, _host: string, cb?: () => void) => {
				if (cb) setTimeout(cb, 0);
				return mockServer;
			}),
		address: vi.fn().mockReturnValue({ port: 3001, address: "127.0.0.1" }),
		close: vi.fn().mockImplementation((cb?: () => void) => {
			if (cb) cb();
		}),
	};
	if (onListen) {
		mockServer.listen.mockImplementation(
			(_port: number, _host: string, cb?: () => void) => {
				if (cb) {
					setTimeout(() => {
						cb();
						onListen();
					}, 0);
				}
				return mockServer;
			},
		);
	}
	return mockServer as unknown as Server;
}

describe("dashboard command", () => {
	let sigintHandlers: Array<() => void>;
	let sigtermHandlers: Array<() => void>;
	let onceSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		sigintHandlers = [];
		sigtermHandlers = [];
		onceSpy = vi.spyOn(process, "once").mockImplementation((event, handler) => {
			if (event === "SIGINT") sigintHandlers.push(handler as () => void);
			if (event === "SIGTERM") sigtermHandlers.push(handler as () => void);
			return process;
		});
	});

	afterEach(() => {
		onceSpy.mockRestore();
	});

	describe("command registration", () => {
		it("registers dashboard command", () => {
			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store: makeMockStore(),
				gateController: makeMockGateController(),
			});
			const cmd = program.commands.find((c) => c.name() === "dashboard");
			expect(cmd).toBeDefined();
		});

		it("has --host option with default 127.0.0.1", () => {
			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store: makeMockStore(),
				gateController: makeMockGateController(),
			});
			const cmd = program.commands.find((c) => c.name() === "dashboard");
			const hostOpt = cmd?.options.find((o) => o.long === "--host");
			expect(hostOpt).toBeDefined();
			expect(hostOpt?.defaultValue).toBe("127.0.0.1");
		});

		it("has --port option with default 3001", () => {
			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store: makeMockStore(),
				gateController: makeMockGateController(),
			});
			const cmd = program.commands.find((c) => c.name() === "dashboard");
			const portOpt = cmd?.options.find((o) => o.long === "--port");
			expect(portOpt).toBeDefined();
			expect(portOpt?.defaultValue).toBe("3001");
		});
	});

	describe("command action", () => {
		async function runDashboard(args: string[] = []) {
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (...a: unknown[]) => logs.push(a.join(" "));

			// Set up server that triggers shutdown after listen callback
			const mockServer = makeMockServer();
			mockCreateDashboardServer.mockReturnValue(mockServer);

			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store: makeMockStore(),
				gateController: makeMockGateController(),
			});

			const parsePromise = program
				.parseAsync(["node", "test", "dashboard", ...args])
				.catch(() => {});

			// Wait for listen callback to fire
			await new Promise((resolve) => setTimeout(resolve, 20));

			// Trigger shutdown via SIGINT
			for (const h of sigintHandlers) h();

			await parsePromise;
			console.log = origLog;

			return { logs, mockServer };
		}

		it("calls createDashboardServer with the store", async () => {
			await runDashboard();
			expect(mockCreateDashboardServer).toHaveBeenCalledWith(
				expect.objectContaining({ store: expect.anything() }),
			);
		});

		it("starts server on default port 3001", async () => {
			const { mockServer } = await runDashboard();
			expect(
				(mockServer as unknown as { listen: ReturnType<typeof vi.fn> }).listen,
			).toHaveBeenCalledWith(3001, "127.0.0.1", expect.any(Function));
		});

		it("uses custom host and port from options", async () => {
			const { mockServer } = await runDashboard([
				"--host",
				"0.0.0.0",
				"--port",
				"8080",
			]);
			expect(
				(mockServer as unknown as { listen: ReturnType<typeof vi.fn> }).listen,
			).toHaveBeenCalledWith(8080, "0.0.0.0", expect.any(Function));
		});

		it("logs listening URL after server starts", async () => {
			const { logs } = await runDashboard();
			expect(logs.some((l) => l.includes("listening"))).toBe(true);
		});

		it("logs API base URL", async () => {
			const { logs } = await runDashboard();
			expect(logs.some((l) => l.includes("/api/v1"))).toBe(true);
		});

		it("sets up SIGINT and SIGTERM shutdown handlers", async () => {
			await runDashboard();
			expect(onceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
			expect(onceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
		});

		it("closes server on SIGTERM", async () => {
			const mockServer = makeMockServer();
			mockCreateDashboardServer.mockReturnValue(mockServer);

			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store: makeMockStore(),
				gateController: makeMockGateController(),
			});

			const parsePromise = program
				.parseAsync(["node", "test", "dashboard"])
				.catch(() => {});

			await new Promise((resolve) => setTimeout(resolve, 20));
			// Trigger SIGTERM
			for (const h of sigtermHandlers) h();

			await parsePromise;
			expect(
				(mockServer as unknown as { close: ReturnType<typeof vi.fn> }).close,
			).toHaveBeenCalled();
		});

		it("preserves paused_at_gate pipelines on shutdown — only cancels running ones", async () => {
			// Regression: a pipeline waiting at an approval gate has no in-flight
			// LLM call to abort. Cancelling it on SIGINT destroys durable state
			// that the user is actively waiting to approve, making the pipeline
			// come back as "cancelled" after a server restart.
			const mockServer = makeMockServer();
			mockCreateDashboardServer.mockReturnValue(mockServer);

			const stopPipeline = vi.fn().mockResolvedValue(undefined);
			const pipelineController = {
				stopPipeline,
			} as unknown as PipelineController;

			const store = {
				...makeMockStore(),
				listPipelineRuns: vi.fn().mockResolvedValue([
					{ id: "run-running", status: "running" },
					{ id: "run-gate", status: "paused_at_gate" },
					{ id: "run-done", status: "completed" },
				]),
			} as unknown as IStateStore;

			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store,
				gateController: makeMockGateController(),
				pipelineController,
			});

			const parsePromise = program
				.parseAsync(["node", "test", "dashboard"])
				.catch(() => {});

			await new Promise((resolve) => setTimeout(resolve, 20));
			for (const h of sigintHandlers) h();
			await parsePromise;

			const stoppedIds = stopPipeline.mock.calls.map((c) => c[0]);
			expect(stoppedIds).toEqual(["run-running"]);
			expect(stoppedIds).not.toContain("run-gate");
		});
	});

	describe("executePipeline callback (when config + pipelineController are provided)", () => {
		function makeMockConfig(): AppConfig {
			return {
				outputDir: "/tmp/test-output",
				anthropicApiKey: "test-key",
				llm: {
					provider: "anthropic",
					model: "claude-sonnet-4-20250514",
					maxTokens: 8192,
				},
			} as AppConfig;
		}

		function makeMockPipelineController(): PipelineController {
			return {
				approveGate: vi.fn().mockResolvedValue(undefined),
				rejectGate: vi.fn().mockResolvedValue(undefined),
				reviseGate: vi.fn().mockResolvedValue(undefined),
				startPipeline: vi.fn(),
				schedulePhasePublic: vi.fn(),
			} as unknown as PipelineController;
		}

		async function startDashboardWithCallback(
			storeOverrides: Partial<IStateStore> = {},
		): Promise<{
			capturedExecutePipeline: ((...args: unknown[]) => void) | undefined;
			cleanup: () => Promise<void>;
		}> {
			let capturedExecutePipeline: ((...args: unknown[]) => void) | undefined;

			const mockServer = makeMockServer();
			mockCreateDashboardServer.mockImplementation(
				(ctx: Record<string, unknown>) => {
					capturedExecutePipeline = ctx.executePipeline as
						| ((...args: unknown[]) => void)
						| undefined;
					return mockServer;
				},
			);

			const store = {
				...makeMockStore(),
				getPipelineRun: vi.fn().mockResolvedValue({
					id: "run-1",
					sessionName: "session-abc",
					projectName: "test-project",
					status: "running",
				}),
				...storeOverrides,
			} as unknown as IStateStore;

			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store,
				gateController: makeMockGateController(),
				pipelineController: makeMockPipelineController(),
				config: makeMockConfig(),
				agentExecutor: makeMockAgentExecutor(),
			});

			const parsePromise = program
				.parseAsync(["node", "test", "dashboard"])
				.catch(() => {});

			await new Promise((resolve) => setTimeout(resolve, 20));
			for (const h of sigintHandlers) h();
			await parsePromise;

			return {
				capturedExecutePipeline,
				cleanup: async () => {},
			};
		}

		it("creates executePipeline callback when config and pipelineController are provided", async () => {
			const { capturedExecutePipeline } = await startDashboardWithCallback();
			expect(capturedExecutePipeline).toBeDefined();
		});

		it("executePipeline callback calls store.getPipelineRun", async () => {
			const getPipelineRun = vi.fn().mockResolvedValue({
				id: "run-1",
				sessionName: "my-session",
				projectName: "my-project",
				status: "running",
			});
			const { capturedExecutePipeline } = await startDashboardWithCallback({
				getPipelineRun,
			} as Partial<IStateStore>);

			if (capturedExecutePipeline) {
				mockExecutePipeline.mockResolvedValue({ pausedAtGate: false });
				capturedExecutePipeline("run-1", "my-project", {}, {});
				// Give async calls time to fire
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
			expect(getPipelineRun).toHaveBeenCalledWith("run-1");
		});

		it("executePipeline callback logs paused gate message when pausedAtGate is true", async () => {
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (...a: unknown[]) => logs.push(a.join(" "));

			const { capturedExecutePipeline } = await startDashboardWithCallback();

			mockExecutePipeline.mockResolvedValue({
				pausedAtGate: true,
				gateId: "gate-123",
			});

			if (capturedExecutePipeline) {
				capturedExecutePipeline("run-1", "my-project", {}, {});
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			console.log = origLog;
			expect(
				logs.some((l) => l.includes("paused at gate") || l.includes("gate")),
			).toBe(true);
		});

		it("executePipeline callback logs finished status when pipeline completes", async () => {
			const logs: string[] = [];
			const origLog = console.log;
			console.log = (...a: unknown[]) => logs.push(a.join(" "));

			const store = {
				...makeMockStore(),
				getPipelineRun: vi
					.fn()
					.mockResolvedValueOnce({
						id: "run-1",
						sessionName: "s1",
						projectName: "proj",
						status: "running",
					})
					.mockResolvedValueOnce({
						id: "run-1",
						sessionName: "s1",
						projectName: "proj",
						status: "completed",
					}),
			} as unknown as IStateStore;

			let capturedExecutePipeline: ((...args: unknown[]) => void) | undefined;
			const mockServer = makeMockServer();
			mockCreateDashboardServer.mockImplementation(
				(ctx: Record<string, unknown>) => {
					capturedExecutePipeline = ctx.executePipeline as
						| ((...args: unknown[]) => void)
						| undefined;
					return mockServer;
				},
			);

			const program = new Command();
			program.exitOverride();
			registerDashboardCommand(program, {
				store,
				gateController: makeMockGateController(),
				pipelineController: makeMockPipelineController(),
				config: makeMockConfig(),
				agentExecutor: makeMockAgentExecutor(),
			});

			const parsePromise = program
				.parseAsync(["node", "test", "dashboard"])
				.catch(() => {});

			await new Promise((resolve) => setTimeout(resolve, 20));
			for (const h of sigintHandlers) h();
			await parsePromise;

			mockExecutePipeline.mockResolvedValue({ pausedAtGate: false });

			if (capturedExecutePipeline) {
				capturedExecutePipeline("run-1", "my-project", {}, {});
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			console.log = origLog;
			expect(
				logs.some(
					(l) =>
						l.includes("finished") ||
						l.includes("completed") ||
						l.includes("run-1"),
				),
			).toBe(true);
		});

		it("executePipeline callback logs error when executor throws", async () => {
			const errors: string[] = [];
			const origErr = console.error;
			console.error = (...a: unknown[]) => errors.push(a.join(" "));

			const { capturedExecutePipeline } = await startDashboardWithCallback();

			mockExecutePipeline.mockRejectedValue(new Error("executor crashed"));

			if (capturedExecutePipeline) {
				capturedExecutePipeline("run-1", "my-project", {}, {});
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			console.error = origErr;
			expect(
				errors.some(
					(e) => e.includes("executor crashed") || e.includes("error"),
				),
			).toBe(true);
		});
	});
});
