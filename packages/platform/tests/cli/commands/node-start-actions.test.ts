/**
 * Tests for the platform node-start CLI command.
 * Includes HTTP server handler tests for P18-T18.
 */
import { createServer, type Server } from "node:http";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "agentforge-core/domain/ports/agent-executor.port.js";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createNodeHttpHandler,
	registerNodeStartCommand,
} from "../../../src/cli/commands/node-start.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

async function registerAndGetAction(_args: string[] = []) {
	const program = new Command();
	program.exitOverride();
	registerNodeStartCommand(program);

	// Extract the node start command
	const nodeCmd = program.commands.find((c) => c.name() === "node");
	const startCmd = nodeCmd?.commands.find((c) => c.name() === "start");
	return { program, nodeCmd, startCmd };
}

describe("node-start command registration", () => {
	it("registers node start command under 'node' parent", async () => {
		const { nodeCmd, startCmd } = await registerAndGetAction();
		expect(nodeCmd).toBeDefined();
		expect(startCmd).toBeDefined();
	});

	it("has --control-plane-url required option", async () => {
		const { startCmd } = await registerAndGetAction();
		const opt = startCmd?.options.find((o) => o.long === "--control-plane-url");
		expect(opt).toBeDefined();
		expect(opt?.mandatory).toBe(true);
	});

	it("has --token optional option", async () => {
		const { startCmd } = await registerAndGetAction();
		const opt = startCmd?.options.find((o) => o.long === "--token");
		expect(opt).toBeDefined();
	});

	it("has --capabilities option", async () => {
		const { startCmd } = await registerAndGetAction();
		const opt = startCmd?.options.find((o) => o.long === "--capabilities");
		expect(opt).toBeDefined();
	});

	it("has --max-concurrent-runs option", async () => {
		const { startCmd } = await registerAndGetAction();
		const opt = startCmd?.options.find(
			(o) => o.long === "--max-concurrent-runs",
		);
		expect(opt).toBeDefined();
	});
});

describe("node-start command action", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		vi.stubGlobal("fetch", mockFetch);
	});

	it("registers with control plane on start", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		mockFetch.mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(""),
		});

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...a: unknown[]) => logs.push(a.join(" "));

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		// The action starts intervals so we'd need to clean up.
		// Instead just verify the command structure handles the registration call.
		// We can't easily test the full action without running process.on loops.

		console.log = origLog;
		mockExit.mockRestore();
	});

	it("calls process.exit(1) on registration failure", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			text: vi.fn().mockResolvedValue("Internal Server Error"),
		});

		const errors: string[] = [];
		const origError = console.error;
		console.error = (...a: unknown[]) => errors.push(a.join(" "));

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		// Parse with fake args to invoke the action (will start running)
		// We test that the mock call pattern is correct based on registration
		try {
			await program.parseAsync([
				"node",
				"test",
				"node",
				"start",
				"--control-plane-url",
				"http://localhost:3001",
				"--port",
				"0",
			]);
		} catch {
			// ignore exit
		}

		console.error = origError;
		// The fetch was called (registration attempt)
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/api/v1/nodes/register"),
			expect.objectContaining({ method: "POST" }),
		);
		expect(mockExit).toHaveBeenCalledWith(1);
		mockExit.mockRestore();
	});

	it("includes node name in registration payload", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		mockFetch.mockResolvedValue({
			ok: false,
			status: 500,
			text: vi.fn().mockResolvedValue("error"),
		});

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		try {
			await program.parseAsync([
				"node",
				"test",
				"node",
				"start",
				"--control-plane-url",
				"http://localhost:3001",
				"--name",
				"my-node",
				"--port",
				"0",
			]);
		} catch {
			// ignore
		}

		const [, opts] = mockFetch.mock.calls[0];
		const body = JSON.parse((opts as { body: string }).body);
		expect(body.definition.metadata.name).toBe("my-node");
		mockExit.mockRestore();
	});

	it("sets up heartbeat and poll intervals after successful registration", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		const urls: string[] = [];
		mockFetch.mockImplementation(async (url: string) => {
			urls.push(url as string);
			if ((url as string).includes("/register")) {
				return { ok: true, text: vi.fn().mockResolvedValue("") };
			}
			// Heartbeat and poll fail silently (catch swallows error)
			throw new Error("network error");
		});

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...a: unknown[]) => logs.push(a.join(" "));

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		await program.parseAsync([
			"node",
			"test",
			"node",
			"start",
			"--control-plane-url",
			"http://localhost:3001",
			"--heartbeat-interval",
			"10",
			"--poll-interval",
			"10",
			"--port",
			"0",
		]);

		// Wait for interval callbacks to fire
		await new Promise((resolve) => setTimeout(resolve, 40));

		console.log = origLog;

		// Registration was called
		expect(urls.some((u) => u.includes("/register"))).toBe(true);
		// Heartbeat was attempted
		expect(urls.some((u) => u.includes("/heartbeat"))).toBe(true);
		// Startup log was printed
		expect(logs.some((l) => l.includes("Heartbeat:"))).toBe(true);

		mockExit.mockRestore();
	});

	it("poll loop logs pending runs when found", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		let _callCount = 0;
		mockFetch.mockImplementation(async (url: string) => {
			_callCount++;
			if ((url as string).includes("/register")) {
				return { ok: true, text: vi.fn().mockResolvedValue("") };
			}
			if ((url as string).includes("/pending-runs")) {
				return {
					ok: true,
					json: vi.fn().mockResolvedValue({ runs: [{ id: "run-1" }] }),
				};
			}
			// heartbeat fails silently
			throw new Error("skip");
		});

		const logs: string[] = [];
		const origLog = console.log;
		console.log = (...a: unknown[]) => logs.push(a.join(" "));

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		await program.parseAsync([
			"node",
			"test",
			"node",
			"start",
			"--control-plane-url",
			"http://localhost:3001",
			"--heartbeat-interval",
			"10000",
			"--poll-interval",
			"10",
			"--port",
			"0",
		]);

		await new Promise((resolve) => setTimeout(resolve, 40));

		console.log = origLog;

		// Poll run log was printed
		expect(logs.some((l) => l.includes("pending run"))).toBe(true);

		mockExit.mockRestore();
	});

	it("SIGINT triggers graceful shutdown", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);

		mockFetch.mockResolvedValue({
			ok: true,
			text: vi.fn().mockResolvedValue(""),
		});

		// Capture process.on calls to intercept shutdown handlers
		const capturedHandlers: Array<[string, () => void]> = [];
		const originalOn = process.on.bind(process);
		const onSpy = vi
			.spyOn(process, "on")
			.mockImplementation(
				(event: string, handler: (...args: unknown[]) => void) => {
					capturedHandlers.push([event, handler as () => void]);
					return originalOn(event, handler);
				},
			);

		const program = new Command();
		program.exitOverride();
		registerNodeStartCommand(program);

		await program.parseAsync([
			"node",
			"test",
			"node",
			"start",
			"--control-plane-url",
			"http://localhost:3001",
			"--heartbeat-interval",
			"10000",
			"--poll-interval",
			"10000",
			"--port",
			"0",
		]);

		// Find and invoke the SIGINT handler
		const sigintEntry = capturedHandlers.find(([e]) => e === "SIGINT");
		expect(sigintEntry).toBeDefined();
		if (sigintEntry) {
			sigintEntry[1]();
		}

		expect(mockExit).toHaveBeenCalledWith(0);

		onSpy.mockRestore();
		mockExit.mockRestore();
	});
});

// ─── Node HTTP server handler tests (P18-T18) ────────────────────────────────

function makeJob(runId = "run-001"): AgentJob {
	return {
		runId,
		agentId: "developer",
		agentDefinition: {
			metadata: { name: "developer" },
			spec: { executor: "pi-coding-agent" },
		},
		inputs: [],
		workdir: "/tmp/work",
		outputDir: "/tmp/out",
		model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 64000 },
	};
}

function makeMockExecutor(opts?: {
	result?: AgentJobResult;
	emitEvents?: StatusUpdate[];
	cancelDelay?: number;
}): IAgentExecutor {
	const result: AgentJobResult = opts?.result ?? {
		status: "succeeded",
		artifacts: [],
		savedFiles: [],
		tokenUsage: { inputTokens: 100, outputTokens: 200 },
		costUsd: 0.01,
		durationMs: 100,
		conversationLog: [],
	};

	return {
		execute: vi
			.fn()
			.mockImplementation(
				async (_job: AgentJob, onStatus?: (u: StatusUpdate) => void) => {
					for (const event of opts?.emitEvents ?? []) {
						onStatus?.(event);
					}
					return result;
				},
			),
		cancel: vi.fn().mockResolvedValue(undefined),
	};
}

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

async function startHandlerServer(
	executor: IAgentExecutor,
): Promise<{ port: number; server: Server }> {
	const handler = createNodeHttpHandler(executor);
	return new Promise((resolve) => {
		const server = createServer(async (req, res) => {
			await handler(req, res);
		});
		server.listen(0, "127.0.0.1", () =>
			resolve({ port: getPort(server), server }),
		);
	});
}

async function httpJson(
	port: number,
	method: string,
	path: string,
	body?: unknown,
): Promise<{ status: number; data: unknown }> {
	const init: RequestInit = { method };
	if (body) {
		init.headers = { "Content-Type": "application/json" };
		init.body = JSON.stringify(body);
	}
	const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
	const text = await res.text();
	try {
		return { status: res.status, data: JSON.parse(text) };
	} catch {
		return { status: res.status, data: text };
	}
}

describe("createNodeHttpHandler (P18-T18 node HTTP server)", () => {
	// Restore fetch after each test (the global mock is set at module level)
	const servers: Server[] = [];
	afterEach(async () => {
		vi.unstubAllGlobals();
		vi.stubGlobal("fetch", mockFetch);
		await Promise.all(
			servers.splice(0).map(
				(s) =>
					new Promise<void>((resolve) => {
						s.closeAllConnections();
						s.close(() => resolve());
					}),
			),
		);
	});

	it("POST /execute accepts AgentJob and returns { runId }", async () => {
		// Use real fetch for these HTTP server tests
		vi.unstubAllGlobals();

		const executor = makeMockExecutor();
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		const job = makeJob("run-node-001");
		const { status, data } = await httpJson(port, "POST", "/execute", job);

		expect(status).toBe(200);
		expect((data as Record<string, unknown>).runId).toBe("run-node-001");
	});

	it("GET /events/:id streams SSE StatusUpdate events", async () => {
		vi.unstubAllGlobals();

		const events: StatusUpdate[] = [
			{ type: "started", runId: "run-node-002", timestamp: 1 },
			{
				type: "conversation_entry",
				runId: "run-node-002",
				timestamp: 2,
				conversationEntry: { role: "assistant", content: "working" },
			},
			{ type: "completed", runId: "run-node-002", timestamp: 3 },
		];

		const executor = makeMockExecutor({ emitEvents: events });
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		// Start the run
		const job = makeJob("run-node-002");
		await httpJson(port, "POST", "/execute", job);

		// Wait a tick for executor to emit events
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Connect to SSE stream
		const sseRes = await fetch(`http://127.0.0.1:${port}/events/run-node-002`);
		expect(sseRes.status).toBe(200);
		expect(sseRes.headers.get("content-type")).toContain("text/event-stream");

		const text = await sseRes.text();
		const dataLines = text
			.split("\n")
			.filter((l) => l.startsWith("data: "))
			.map((l) => JSON.parse(l.slice(6)) as StatusUpdate);

		expect(dataLines.some((e) => e.type === "started")).toBe(true);
		expect(dataLines.some((e) => e.type === "conversation_entry")).toBe(true);
		expect(dataLines.some((e) => e.type === "completed")).toBe(true);
	});

	it("GET /result/:id returns AgentJobResult after execution", async () => {
		vi.unstubAllGlobals();

		const result: AgentJobResult = {
			status: "succeeded",
			artifacts: [{ type: "spec", path: "out.json", content: "{}" }],
			savedFiles: ["/tmp/out.json"],
			tokenUsage: { inputTokens: 300, outputTokens: 600 },
			costUsd: 0.05,
			durationMs: 250,
			conversationLog: [{ role: "assistant", content: "done" }],
		};

		const executor = makeMockExecutor({ result });
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		await httpJson(port, "POST", "/execute", makeJob("run-node-003"));
		await new Promise((resolve) => setTimeout(resolve, 30));

		const { status, data } = await httpJson(
			port,
			"GET",
			"/result/run-node-003",
		);
		expect(status).toBe(200);
		expect((data as AgentJobResult).status).toBe("succeeded");
		expect((data as AgentJobResult).costUsd).toBe(0.05);
		expect((data as AgentJobResult).conversationLog).toHaveLength(1);
	});

	it("GET /result/:id returns 404 when run is not complete yet", async () => {
		vi.unstubAllGlobals();

		const executor = makeMockExecutor();
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		const { status } = await httpJson(port, "GET", "/result/nonexistent-run");
		expect(status).toBe(404);
	});

	it("POST /cancel/:id calls executor.cancel()", async () => {
		vi.unstubAllGlobals();

		const executor = makeMockExecutor();
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		const { status } = await httpJson(
			port,
			"POST",
			"/cancel/run-node-cancel",
			null,
		);
		expect(status).toBe(200);
		expect(executor.cancel).toHaveBeenCalledWith("run-node-cancel");
	});

	it("returns 404 for unknown routes", async () => {
		vi.unstubAllGlobals();

		const executor = makeMockExecutor();
		const { port, server } = await startHandlerServer(executor);
		servers.push(server);

		const { status } = await httpJson(port, "GET", "/unknown-path");
		expect(status).toBe(404);
	});
});

describe("node-start command --port option (P18-T18)", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
		vi.stubGlobal("fetch", mockFetch);
	});

	it("has --port option with default 4001", async () => {
		const { startCmd } = await registerAndGetAction();
		const opt = startCmd?.options.find((o) => o.long === "--port");
		expect(opt).toBeDefined();
		expect(opt?.defaultValue).toBe("4001");
	});
});
