import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAgentExecutor } from "../../../src/adapters/execution/local-agent-executor.js";
import type {
	AgentRunner,
	AgentRunOutput,
} from "../../../src/agents/runner.js";
import type { Container } from "../../../src/di/container.js";
import type {
	AgentJob,
	StatusUpdate,
} from "../../../src/domain/ports/agent-executor.port.js";

// Mock the agent runner module — preserve AgentTimeoutError class used by
// the executor's exitReason branch.
vi.mock("../../../src/agents/runner.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../../src/agents/runner.js")>();
	return {
		...actual,
		createAgent: vi.fn(),
	};
});

// Mock the cost calculator
vi.mock("../../../src/utils/cost-calculator.js", () => ({
	estimateCostUsd: vi.fn().mockReturnValue(0.045),
}));

import { createAgent } from "../../../src/agents/runner.js";

const mockedCreateAgent = vi.mocked(createAgent);

function makeJob(overrides?: Partial<AgentJob>): AgentJob {
	return {
		runId: "run-001",
		agentId: "developer",
		agentDefinition: {
			metadata: { name: "developer", phase: 4, executor: "pi-coding-agent" },
			spec: { executor: "pi-coding-agent" },
		},
		inputs: [{ type: "spec", path: "arch.json", content: '{"components":[]}' }],
		workdir: join(tmpdir(), "sdlc-test-workdir"),
		outputDir: join(tmpdir(), "sdlc-test-output"),
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4-20250514",
			maxTokens: 64000,
		},
		...overrides,
	};
}

function makeRunOutput(overrides?: Partial<AgentRunOutput>): AgentRunOutput {
	return {
		artifacts: [
			{ type: "code", path: "api-code.json", content: '{"routes":[]}' },
		],
		tokenUsage: { inputTokens: 8000, outputTokens: 12000 },
		durationMs: 5000,
		savedFiles: ["/output/api-code.json"],
		conversationLog: [
			{ role: "user", content: "Generate API", timestamp: Date.now() },
			{
				role: "assistant",
				content: "Here is the API...",
				timestamp: Date.now(),
			},
		],
		...overrides,
	};
}

function makeMockContainer(): Container {
	return {
		executionBackend: { runAgent: vi.fn() },
		artifactStore: {
			save: vi.fn().mockResolvedValue({
				absolutePath: "/saved",
				path: "x",
				type: "code",
				size: 10,
				createdAt: "",
			}),
			load: vi.fn(),
			list: vi.fn(),
		},
		promptLoader: { load: vi.fn().mockResolvedValue("You are Developer...") },
		logger: {
			info: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			child: vi.fn().mockReturnThis(),
		},
		config: {
			llm: {
				provider: "anthropic",
				model: "claude-sonnet-4-20250514",
				apiKey: "test",
				maxTokens: 64000,
			},
			outputDir: "/tmp/output",
			promptsDir: "/tmp/prompts",
			logLevel: "info",
		},
	};
}

describe("LocalAgentExecutor", () => {
	let workdir: string;
	let outputDir: string;

	beforeEach(() => {
		workdir = join(tmpdir(), `sdlc-test-workdir-${Date.now()}`);
		outputDir = join(tmpdir(), `sdlc-test-output-${Date.now()}`);
		mkdirSync(workdir, { recursive: true });
		mkdirSync(outputDir, { recursive: true });
		vi.clearAllMocks();
	});

	afterEach(() => {
		try {
			rmSync(workdir, { recursive: true, force: true });
			rmSync(outputDir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	});

	it("executes an agent job and returns AgentJobResult", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockResolvedValue(makeRunOutput()),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		expect(result.status).toBe("succeeded");
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0].type).toBe("code");
		expect(result.savedFiles).toEqual(["/output/api-code.json"]);
		expect(result.tokenUsage.inputTokens).toBe(8000);
		expect(result.tokenUsage.outputTokens).toBe(12000);
		expect(result.costUsd).toBe(0.045);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.conversationLog).toHaveLength(2);
		expect(result.error).toBeUndefined();
	});

	it("streams status updates via onStatus callback", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockResolvedValue(makeRunOutput()),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const updates: StatusUpdate[] = [];
		const job = makeJob({ workdir, outputDir });
		await executor.execute(job, (update) => updates.push(update));

		// Should emit at least "started" and "completed"
		expect(updates.length).toBeGreaterThanOrEqual(2);
		expect(updates[0].type).toBe("started");
		expect(updates[0].runId).toBe("run-001");
		expect(updates[updates.length - 1].type).toBe("completed");
	});

	it("returns failed status on agent error", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockRejectedValue(new Error("LLM rate limit exceeded")),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const updates: StatusUpdate[] = [];
		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job, (update) =>
			updates.push(update),
		);

		expect(result.status).toBe("failed");
		expect(result.error).toBe("LLM rate limit exceeded");
		expect(result.exitReason).toBe("error");
		expect(result.artifacts).toEqual([]);
		expect(result.savedFiles).toEqual([]);

		// Should emit "started" then "failed"
		expect(updates[0].type).toBe("started");
		expect(updates[updates.length - 1].type).toBe("failed");
		expect(updates[updates.length - 1].message).toContain("LLM rate limit");
	});

	it("returns exitReason=timeout when runner throws AgentTimeoutError", async () => {
		const { AgentTimeoutError } = await import("../../../src/agents/runner.js");
		const mockRunner: AgentRunner = {
			run: vi
				.fn()
				.mockRejectedValue(
					new AgentTimeoutError(
						"developer",
						600,
						'Agent "developer" timed out after 600s.',
					),
				),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});
		const result = await executor.execute(makeJob({ workdir, outputDir }));

		expect(result.status).toBe("failed");
		expect(result.exitReason).toBe("timeout");
		expect(result.error).toContain("timed out");
	});

	it("passes revision notes as prompt", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockResolvedValue(makeRunOutput()),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const job = makeJob({
			workdir,
			outputDir,
			revisionNotes: "Add rate limiting",
		});
		await executor.execute(job);

		const runCall = (mockRunner.run as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		expect(runCall.prompt).toContain("Revision Request");
		expect(runCall.prompt).toContain("Add rate limiting");
	});

	it("passes input artifacts to runner", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockResolvedValue(makeRunOutput()),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const inputs = [
			{ type: "spec" as const, path: "arch.json", content: '{"arch": true}' },
			{ type: "spec" as const, path: "plan.json", content: '{"plan": true}' },
		];
		const job = makeJob({ workdir, outputDir, inputs });
		await executor.execute(job);

		const runCall = (mockRunner.run as ReturnType<typeof vi.fn>).mock
			.calls[0][0];
		// Input should be passed to runner (as paths or formatted content)
		expect(runCall.input).toBeDefined();
	});

	it("does NOT interact with state store or controller", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockResolvedValue(makeRunOutput()),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		// The executor has no store or controller references — this is a design constraint
		expect(executor).not.toHaveProperty("store");
		expect(executor).not.toHaveProperty("controller");

		const job = makeJob({ workdir, outputDir });
		await executor.execute(job);
		// If we got here without errors, the executor doesn't need external state
	});

	it("forwards backend conversation events as conversation_entry status updates", async () => {
		// Wire up a fake runner that causes the factory's onEvent hook to fire.
		// In production this is the backend's agent.subscribe() stream; here we
		// simulate it by invoking the onEvent callback captured from the factory.
		let captured: ((e: Parameters<typeof emit>[0]) => void) | undefined;
		type EventArg = {
			role: "user" | "assistant" | "tool_call" | "tool_result";
			content: string;
			name?: string;
			timestamp?: number;
		};
		const emit = (e: EventArg): void => captured?.(e);

		const mockRunner: AgentRunner = {
			run: vi.fn().mockImplementation(async () => {
				// Simulate three incremental events from the backend
				emit({
					role: "assistant",
					content: "Let me read the spec...",
					timestamp: 1000,
				});
				emit({
					role: "tool_call",
					content: '{"path":"spec.md"}',
					name: "read_file",
					timestamp: 1100,
				});
				emit({
					role: "tool_result",
					content: "# Spec\nBuild an API",
					name: "read_file",
					timestamp: 1200,
				});
				return makeRunOutput();
			}),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const executor = new LocalAgentExecutor({
			createContainerFn: (_executor, _workdir, onEvent) => {
				captured = onEvent;
				return makeMockContainer();
			},
		});

		const updates: StatusUpdate[] = [];
		const job = makeJob({ workdir, outputDir });
		await executor.execute(job, (u) => updates.push(u));

		const convUpdates = updates.filter((u) => u.type === "conversation_entry");
		expect(convUpdates).toHaveLength(3);
		expect(convUpdates[0].conversationEntry?.content).toBe(
			"Let me read the spec...",
		);
		expect(convUpdates[1].conversationEntry?.role).toBe("tool_call");
		expect(convUpdates[1].conversationEntry?.name).toBe("read_file");
		expect(convUpdates[2].conversationEntry?.role).toBe("tool_result");
		expect(convUpdates[0].runId).toBe("run-001");
		// Timestamp from the entry should flow through
		expect(convUpdates[0].timestamp).toBe(1000);
	});

	it("cancel() aborts an in-flight run via AbortController", async () => {
		// The runner is mocked to block on a promise we control. We call cancel()
		// while it's pending and verify the signal fires.
		let signalSeen: AbortSignal | undefined;
		let resolveRun!: (value: AgentRunOutput) => void;
		const runPromise = new Promise<AgentRunOutput>((resolve) => {
			resolveRun = resolve;
		});
		const mockRunner: AgentRunner = {
			run: vi.fn().mockImplementation((opts) => {
				signalSeen = opts.signal;
				return runPromise;
			}),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const executor = new LocalAgentExecutor({
			createContainerFn: () => makeMockContainer(),
		});

		const job = makeJob({ runId: "cancel-test-1", workdir, outputDir });
		const execPromise = executor.execute(job);

		// Wait a tick so execute() registers the active run
		await new Promise((r) => setImmediate(r));
		expect(signalSeen).toBeDefined();
		expect(signalSeen?.aborted).toBe(false);

		await executor.cancel("cancel-test-1");
		expect(signalSeen?.aborted).toBe(true);

		// Let the runner resolve (simulate backend cleanup)
		resolveRun(makeRunOutput());
		const result = await execPromise;
		// The result still flows through even though cancel was called — the
		// executor itself doesn't poison the result; the pipeline-executor race
		// guard handles that by checking DB state.
		expect(result.status).toBe("succeeded");
	});

	it("cancel() is a no-op for unknown run ids", async () => {
		const executor = new LocalAgentExecutor({
			createContainerFn: () => makeMockContainer(),
		});
		await expect(executor.cancel("nonexistent")).resolves.toBeUndefined();
	});

	it("measures duration independently", async () => {
		const mockRunner: AgentRunner = {
			run: vi.fn().mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 50));
				return makeRunOutput();
			}),
		};
		mockedCreateAgent.mockReturnValue(mockRunner);

		const mockContainer = makeMockContainer();
		const executor = new LocalAgentExecutor({
			createContainerFn: () => mockContainer,
		});

		const job = makeJob({ workdir, outputDir });
		const result = await executor.execute(job);

		expect(result.durationMs).toBeGreaterThanOrEqual(40); // at least ~50ms
	});
});
