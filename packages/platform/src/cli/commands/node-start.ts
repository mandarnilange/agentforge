/**
 * CLI node start command — launches a NodeWorker that connects to a
 * remote control plane via HTTP. The node registers itself, starts
 * heartbeating, polls for work, and exposes an HTTP server so the
 * control plane's RemoteAgentExecutor can push jobs directly via SSE.
 *
 * Usage: sdlc-agent node start --control-plane-url <url> --token <token>
 */

import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "agentforge-core/domain/ports/agent-executor.port.js";
import chalk from "chalk";
import type { Command } from "commander";

interface NodeStartOptions {
	controlPlaneUrl: string;
	token?: string;
	name?: string;
	capabilities?: string;
	maxConcurrentRuns?: string;
	heartbeatInterval?: string;
	pollInterval?: string;
	port?: string;
	host?: string;
}

/** Per-run state tracked by the node HTTP server. */
interface RunState {
	events: StatusUpdate[];
	sseClients: Set<ServerResponse>;
	result?: AgentJobResult;
}

/**
 * Create a request handler for the node-side executor HTTP server.
 * Exported for testability.
 *
 * Routes:
 *   POST /execute            — accept AgentJob, start execution, return { runId }
 *   GET  /events/:id         — SSE stream of StatusUpdate events
 *   GET  /result/:id         — return AgentJobResult (404 if not done yet)
 *   POST /cancel/:id         — cancel in-flight run
 */
export function createNodeHttpHandler(
	executor: IAgentExecutor,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
	const runs = new Map<string, RunState>();

	return async function handler(req: IncomingMessage, res: ServerResponse) {
		const method = req.method ?? "GET";
		const path = req.url ?? "/";

		// POST /execute
		if (method === "POST" && path === "/execute") {
			const job = (await readBody(req)) as AgentJob;
			const { runId } = job;

			const state: RunState = { events: [], sseClients: new Set() };
			runs.set(runId, state);

			// Execute in background — forward StatusUpdates to buffered state + SSE clients
			void executor
				.execute(job, (update) => {
					state.events.push(update);
					for (const client of state.sseClients) {
						client.write(`data: ${JSON.stringify(update)}\n\n`);
					}
					if (update.type === "completed" || update.type === "failed") {
						for (const client of state.sseClients) {
							client.end();
						}
						state.sseClients.clear();
					}
				})
				.then((result) => {
					state.result = result;
					// Close any late-connecting SSE clients
					for (const client of state.sseClients) {
						client.end();
					}
					state.sseClients.clear();
				})
				.catch((err) => {
					const error = err instanceof Error ? err.message : String(err);
					const failedUpdate: StatusUpdate = {
						type: "failed",
						runId,
						message: error,
						timestamp: Date.now(),
					};
					state.events.push(failedUpdate);
					for (const client of state.sseClients) {
						client.write(`data: ${JSON.stringify(failedUpdate)}\n\n`);
						client.end();
					}
					state.sseClients.clear();
					state.result = {
						status: "failed",
						artifacts: [],
						savedFiles: [],
						tokenUsage: { inputTokens: 0, outputTokens: 0 },
						costUsd: 0,
						durationMs: 0,
						conversationLog: [],
						error,
					};
				});

			json(res, 200, { runId });
			return;
		}

		// GET /events/:id — SSE stream
		const eventsMatch = path.match(/^\/events\/([^/]+)$/);
		if (method === "GET" && eventsMatch) {
			const runId = eventsMatch[1];
			const state = runs.get(runId);

			if (!state) {
				json(res, 404, { error: "run not found" });
				return;
			}

			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});

			// Flush buffered events first
			for (const event of state.events) {
				res.write(`data: ${JSON.stringify(event)}\n\n`);
			}

			// If run is already done, close immediately
			if (state.result) {
				res.end();
				return;
			}

			// Register for future events
			state.sseClients.add(res);
			req.on("close", () => {
				state.sseClients.delete(res);
			});
			return;
		}

		// GET /result/:id
		const resultMatch = path.match(/^\/result\/([^/]+)$/);
		if (method === "GET" && resultMatch) {
			const runId = resultMatch[1];
			const state = runs.get(runId);

			if (!state?.result) {
				json(res, 404, { error: "result not ready" });
				return;
			}

			json(res, 200, state.result);
			return;
		}

		// POST /cancel/:id
		const cancelMatch = path.match(/^\/cancel\/([^/]+)$/);
		if (method === "POST" && cancelMatch) {
			const runId = cancelMatch[1];
			await executor.cancel(runId);
			json(res, 200, { status: "cancelled" });
			return;
		}

		json(res, 404, { error: "not found" });
	};
}

export function registerNodeStartCommand(program: Command): void {
	const nodeCmd =
		program.commands.find((c) => c.name() === "node") ??
		program.command("node").description("Node management commands");

	nodeCmd
		.command("start")
		.description("Start a remote executor node")
		.requiredOption("--control-plane-url <url>", "Control plane HTTP URL")
		.option("--token <token>", "API authentication token")
		.option("--name <name>", "Node name", `node-${process.pid}`)
		.option(
			"--capabilities <list>",
			"Comma-separated capabilities",
			"llm-access",
		)
		.option("--max-concurrent-runs <n>", "Max parallel agent runs", "3")
		.option("--heartbeat-interval <ms>", "Heartbeat interval in ms", "15000")
		.option("--poll-interval <ms>", "Poll interval in ms", "5000")
		.option("--port <port>", "HTTP server port for direct job push", "4001")
		.option("--host <host>", "HTTP server host", "0.0.0.0")
		.action(async (opts: NodeStartOptions) => {
			const nodeName = opts.name ?? `node-${process.pid}`;
			const capabilities = (opts.capabilities ?? "llm-access")
				.split(",")
				.map((c) => c.trim());
			const maxConcurrentRuns = Number.parseInt(
				opts.maxConcurrentRuns ?? "3",
				10,
			);
			const port = Number.parseInt(opts.port ?? "4001", 10);
			const host = opts.host ?? "0.0.0.0";

			console.log(chalk.bold(`Starting executor node: ${nodeName}`));
			console.log(`  Control plane: ${chalk.cyan(opts.controlPlaneUrl)}`);
			console.log(`  Capabilities: ${capabilities.join(", ")}`);
			console.log(`  Max concurrent runs: ${maxConcurrentRuns}`);
			console.log(`  HTTP server: ${chalk.cyan(`http://${host}:${port}`)}`);
			console.log();

			// Build executor from environment config
			let executor: IAgentExecutor;
			try {
				const { loadConfig } = await import(
					"agentforge-core/di/config.js" as string
				);
				const { createAgentExecutor } = await import(
					"agentforge-core/di/executor-factory.js" as string
				);
				const config = loadConfig();
				executor = createAgentExecutor("local", { config });
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to create executor: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
				process.exit(1);
			}

			// Start the executor HTTP server
			const handler = createNodeHttpHandler(executor);
			const httpServer = createServer(async (req, res) => {
				await handler(req, res);
			});

			await new Promise<void>((resolve) => {
				httpServer.listen(port, host, resolve);
			});

			console.log(
				chalk.green(`Executor HTTP server listening on ${host}:${port}`),
			);

			// Determine the public URL for registration
			const nodeHttpUrl =
				host === "0.0.0.0"
					? `http://127.0.0.1:${port}`
					: `http://${host}:${port}`;

			// Register with control plane
			try {
				const registerRes = await fetch(
					`${opts.controlPlaneUrl}/api/v1/nodes/register`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							...(opts.token ? { "X-Node-Token": opts.token } : {}),
						},
						body: JSON.stringify({
							definition: {
								metadata: {
									name: nodeName,
									type: "remote",
									httpUrl: nodeHttpUrl,
								},
								spec: {
									capabilities,
									resources: { maxConcurrentRuns },
								},
							},
						}),
					},
				);

				if (!registerRes.ok) {
					throw new Error(
						`Registration failed: ${registerRes.status} ${await registerRes.text()}`,
					);
				}

				console.log(chalk.green("Registered with control plane"));
			} catch (err) {
				console.error(
					chalk.red(
						`Failed to register: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
				process.exit(1);
			}

			// Track active runs for heartbeat
			let activeRuns = 0;

			// Heartbeat loop
			const heartbeatMs = Number.parseInt(
				opts.heartbeatInterval ?? "15000",
				10,
			);
			const heartbeatInterval = setInterval(async () => {
				try {
					await fetch(
						`${opts.controlPlaneUrl}/api/v1/nodes/${nodeName}/heartbeat`,
						{
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								...(opts.token ? { "X-Node-Token": opts.token } : {}),
							},
							body: JSON.stringify({ activeRuns }),
						},
					);
				} catch {
					// Best effort heartbeat
				}
			}, heartbeatMs);

			// Poll loop — fetch queued jobs from the control plane
			const pollMs = Number.parseInt(opts.pollInterval ?? "5000", 10);
			const pollInterval = setInterval(async () => {
				try {
					const res = await fetch(
						`${opts.controlPlaneUrl}/api/v1/nodes/${nodeName}/pending-runs`,
						{
							headers: opts.token ? { "X-Node-Token": opts.token } : {},
						},
					);
					if (res.ok) {
						const { runs } = (await res.json()) as {
							runs: AgentJob[];
						};
						if (runs.length > 0) {
							console.log(
								chalk.yellow(`Received ${runs.length} pending run(s)`),
							);
							for (const job of runs) {
								activeRuns++;
								void executor
									.execute(job)
									.then(async (result) => {
										activeRuns--;
										// Report result back to control plane
										await fetch(
											`${opts.controlPlaneUrl}/api/v1/runs/${job.runId}/result`,
											{
												method: "POST",
												headers: {
													"Content-Type": "application/json",
													...(opts.token ? { "X-Node-Token": opts.token } : {}),
												},
												body: JSON.stringify({
													result: {
														runId: job.runId,
														success: result.status === "succeeded",
														result: {
															artifacts: result.artifacts,
															tokenUsage: result.tokenUsage,
															durationMs: result.durationMs,
															events: [],
														},
														error: result.error,
														durationMs: result.durationMs,
														conversationLog: result.conversationLog,
													},
												}),
											},
										);
									})
									.catch((err) => {
										activeRuns--;
										console.error(
											chalk.red(
												`Run ${job.runId} failed: ${err instanceof Error ? err.message : String(err)}`,
											),
										);
									});
							}
						}
					}
				} catch {
					// Best effort polling
				}
			}, pollMs);

			// Graceful shutdown
			const shutdown = () => {
				console.log(chalk.dim("\nShutting down node..."));
				clearInterval(heartbeatInterval);
				clearInterval(pollInterval);
				httpServer.closeAllConnections();
				httpServer.close();
				process.exit(0);
			};

			process.on("SIGTERM", shutdown);
			process.on("SIGINT", shutdown);

			console.log(
				chalk.dim(
					`Heartbeat: ${heartbeatMs}ms | Poll: ${pollMs}ms | Press Ctrl+C to stop`,
				),
			);
		});
}

function json(res: ServerResponse, status: number, data: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => {
			try {
				resolve(JSON.parse(body));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}
