/**
 * RemoteAgentExecutor tests — SSE streaming (P18-T18).
 * Replaces the old poll-based tests now that the executor uses SSE /events/:id.
 */
import { createServer, type Server } from "node:http";
import type {
	AgentJob,
	AgentJobResult,
	StatusUpdate,
} from "@mandarnilange/agentforge-core/domain/ports/agent-executor.port.js";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteAgentExecutor } from "../../../src/adapters/execution/remote-agent-executor.js";

function makeJob(overrides?: Partial<AgentJob>): AgentJob {
	return {
		runId: "run-001",
		agentId: "developer",
		agentDefinition: {
			metadata: { name: "developer" },
			spec: { executor: "pi-coding-agent" },
		},
		inputs: [],
		workdir: "/tmp/work",
		outputDir: "/tmp/out",
		model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 64000 },
		...overrides,
	};
}

const MOCK_RESULT: AgentJobResult = {
	status: "succeeded",
	artifacts: [{ type: "code", path: "api.json", content: "{}" }],
	savedFiles: ["/out/api.json"],
	tokenUsage: { inputTokens: 5000, outputTokens: 8000 },
	costUsd: 0.135,
	durationMs: 3000,
	conversationLog: [{ role: "assistant", content: "done" }],
};

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

/**
 * Start a mock executor node HTTP server.
 * Supports POST /execute, GET /events/:id (SSE), GET /result/:id, POST /cancel/:id.
 */
function startMockNodeServer(opts: {
	events: StatusUpdate[];
	result: AgentJobResult;
	executeStatus?: number;
	eventsStatus?: number;
	resultStatus?: number;
	onCancel?: (runId: string) => void;
}): Promise<{ port: number; capturedJob: () => AgentJob | null }> {
	let captured: AgentJob | null = null;

	return new Promise((resolve) => {
		const server = createServer(async (req, res) => {
			const method = req.method ?? "GET";
			const path = req.url ?? "/";

			// POST /execute
			if (method === "POST" && path === "/execute") {
				let body = "";
				req.on("data", (c) => (body += c));
				req.on("end", () => {
					captured = JSON.parse(body) as AgentJob;
					const status = opts.executeStatus ?? 200;
					if (status !== 200) {
						res.writeHead(status, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "error" }));
						return;
					}
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ runId: captured.runId }));
				});
				return;
			}

			// GET /events/:id — SSE stream
			const eventsMatch = path.match(/^\/events\/([^/]+)$/);
			if (method === "GET" && eventsMatch) {
				const status = opts.eventsStatus ?? 200;
				if (status !== 200) {
					res.writeHead(status);
					res.end();
					return;
				}
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				for (const event of opts.events) {
					res.write(`data: ${JSON.stringify(event)}\n\n`);
				}
				res.end();
				return;
			}

			// GET /result/:id
			const resultMatch = path.match(/^\/result\/([^/]+)$/);
			if (method === "GET" && resultMatch) {
				const status = opts.resultStatus ?? 200;
				if (status !== 200) {
					res.writeHead(status, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "error" }));
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(opts.result));
				return;
			}

			// POST /cancel/:id
			const cancelMatch = path.match(/^\/cancel\/([^/]+)$/);
			if (method === "POST" && cancelMatch) {
				opts.onCancel?.(cancelMatch[1]);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "cancelled" }));
				return;
			}

			res.writeHead(404);
			res.end("{}");
		});

		server.listen(0, "127.0.0.1", () => {
			const port = getPort(server);
			// Track for cleanup
			(server as Server & { _testPort?: number })._testPort = port;
			resolve({ port, capturedJob: () => captured });
		});

		// Auto-close when test ends — store reference
		servers.push(server);
	});
}

// Track servers for cleanup
const servers: Server[] = [];

afterEach(async () => {
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

describe("RemoteAgentExecutor SSE streaming (P18-T18)", () => {
	it("sends AgentJob via POST /execute then streams SSE events then fetches result", async () => {
		const events: StatusUpdate[] = [
			{ type: "started", runId: "run-001", timestamp: 1 },
			{
				type: "conversation_entry",
				runId: "run-001",
				timestamp: 2,
				conversationEntry: { role: "assistant", content: "thinking..." },
			},
			{ type: "completed", runId: "run-001", timestamp: 3 },
		];

		const { port, capturedJob } = await startMockNodeServer({
			events,
			result: MOCK_RESULT,
		});

		const received: StatusUpdate[] = [];
		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		const job = makeJob();
		const result = await executor.execute(job, (u) => received.push(u));

		expect(capturedJob()?.agentId).toBe("developer");
		expect(result.status).toBe("succeeded");
		expect(result.artifacts).toHaveLength(1);
		expect(result.costUsd).toBe(0.135);
		expect(result.conversationLog).toEqual([
			{ role: "assistant", content: "done" },
		]);

		// All SSE events forwarded to onStatus
		expect(received.some((e) => e.type === "started")).toBe(true);
		expect(received.some((e) => e.type === "conversation_entry")).toBe(true);
		expect(received.some((e) => e.type === "completed")).toBe(true);
	});

	it("forwards conversation_entry events to onStatus during streaming", async () => {
		const events: StatusUpdate[] = [
			{ type: "started", runId: "run-001", timestamp: 1 },
			{
				type: "conversation_entry",
				runId: "run-001",
				timestamp: 2,
				conversationEntry: { role: "user", content: "hello" },
			},
			{
				type: "conversation_entry",
				runId: "run-001",
				timestamp: 3,
				conversationEntry: { role: "assistant", content: "world" },
			},
			{ type: "completed", runId: "run-001", timestamp: 4 },
		];

		const { port } = await startMockNodeServer({ events, result: MOCK_RESULT });
		const entries: StatusUpdate[] = [];
		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		await executor.execute(makeJob(), (u) => {
			if (u.type === "conversation_entry") entries.push(u);
		});

		expect(entries).toHaveLength(2);
		expect(entries[0].conversationEntry?.content).toBe("hello");
		expect(entries[1].conversationEntry?.content).toBe("world");
	});

	it("returns failed result when execute endpoint returns non-ok status", async () => {
		const { port } = await startMockNodeServer({
			events: [],
			result: MOCK_RESULT,
			executeStatus: 500,
		});

		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		const result = await executor.execute(makeJob());

		expect(result.status).toBe("failed");
		expect(result.error).toContain("500");
	});

	it("returns failed result when events SSE endpoint returns non-ok status", async () => {
		const { port } = await startMockNodeServer({
			events: [],
			result: MOCK_RESULT,
			eventsStatus: 503,
		});

		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		const result = await executor.execute(makeJob());

		expect(result.status).toBe("failed");
		expect(result.error).toContain("503");
	});

	it("returns failed result when result endpoint returns non-ok status", async () => {
		const { port } = await startMockNodeServer({
			events: [{ type: "completed", runId: "run-001", timestamp: 1 }],
			result: MOCK_RESULT,
			resultStatus: 503,
		});

		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		const result = await executor.execute(makeJob());

		expect(result.status).toBe("failed");
		expect(result.error).toContain("503");
	});

	it("handles connection failure gracefully", async () => {
		const executor = new RemoteAgentExecutor("http://127.0.0.1:19999");
		const result = await executor.execute(makeJob());

		expect(result.status).toBe("failed");
		expect(result.error).toBeTruthy();
	});

	it("sends cancel request to /cancel/:runId", async () => {
		let cancelledRunId: string | null = null;
		const { port } = await startMockNodeServer({
			events: [],
			result: MOCK_RESULT,
			onCancel: (id) => {
				cancelledRunId = id;
			},
		});

		const executor = new RemoteAgentExecutor(`http://127.0.0.1:${port}`);
		await executor.cancel("run-abc");

		expect(cancelledRunId).toBe("run-abc");
	});
});
