/**
 * Control Plane HTTP Routes — the "kube-apiserver" equivalent.
 * Exposes IControlPlaneApi over HTTP for remote node registration,
 * heartbeat, work dispatch, and result reporting.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentJob } from "../../domain/ports/agent-executor.port.js";
import type { IEventBus } from "../../domain/ports/event-bus.port.js";
import type { ConversationEntry } from "../../domain/ports/execution-backend.port.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";

export interface ControlPlaneRouteContext {
	store: IStateStore;
	eventBus: IEventBus;
	/** Per-node pending run queue for the polling-based dispatch flow. */
	pendingRunQueues?: Map<string, AgentJob[]>;
}

/**
 * Handle control-plane specific routes. Returns true if the route was handled.
 */
export async function handleControlPlaneRoute(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: ControlPlaneRouteContext,
): Promise<boolean> {
	const method = req.method ?? "GET";
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = url.pathname;

	// POST /api/v1/nodes/register
	if (method === "POST" && path === "/api/v1/nodes/register") {
		const body = await readBody(req);
		const { definition } = body as {
			definition: {
				metadata: { name: string; type: string };
				spec: {
					capabilities?: string[];
					resources?: { maxConcurrentRuns?: number };
				};
			};
		};

		await ctx.store.upsertNode({
			name: definition.metadata.name,
			type: definition.metadata.type,
			capabilities: definition.spec.capabilities ?? [],
			maxConcurrentRuns: definition.spec.resources?.maxConcurrentRuns,
			status: "online",
			activeRuns: 0,
			lastHeartbeat: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		ctx.eventBus.emit({
			type: "node_online",
			nodeName: definition.metadata.name,
		});

		json(res, 200, { status: "registered" });
		return true;
	}

	// POST /api/v1/nodes/:name/heartbeat
	const heartbeatMatch = path.match(/^\/api\/v1\/nodes\/([^/]+)\/heartbeat$/);
	if (method === "POST" && heartbeatMatch) {
		const nodeName = heartbeatMatch[1];
		const body = await readBody(req);
		const { activeRuns } = body as { activeRuns: number };

		const node = await ctx.store.getNode(nodeName);
		if (node) {
			await ctx.store.upsertNode({
				...node,
				activeRuns: activeRuns ?? node.activeRuns,
				lastHeartbeat: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
		}

		json(res, 200, { status: "ok" });
		return true;
	}

	// GET /api/v1/nodes/:name/pending-runs
	const pendingMatch = path.match(/^\/api\/v1\/nodes\/([^/]+)\/pending-runs$/);
	if (method === "GET" && pendingMatch) {
		const nodeName = pendingMatch[1];
		const queue = ctx.pendingRunQueues?.get(nodeName);
		if (queue && queue.length > 0) {
			const runs = queue.splice(0); // drain the queue atomically
			json(res, 200, { runs });
		} else {
			json(res, 200, { runs: [] });
		}
		return true;
	}

	// POST /api/v1/runs/:id/result
	const resultMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/result$/);
	if (method === "POST" && resultMatch) {
		const runId = resultMatch[1];
		const body = await readBody(req);
		const { result } = body as {
			result: {
				runId: string;
				success: boolean;
				result?: {
					artifacts: unknown[];
					tokenUsage: { inputTokens: number; outputTokens: number };
					durationMs: number;
					events: unknown[];
				};
				error?: string;
				durationMs: number;
				conversationLog?: ConversationEntry[];
			};
		};

		if (result.success && result.result) {
			await ctx.store.updateAgentRun(runId, {
				status: "succeeded",
				durationMs: result.durationMs,
				tokenUsage: result.result.tokenUsage,
				completedAt: new Date().toISOString(),
			});
		} else {
			await ctx.store.updateAgentRun(runId, {
				status: "failed",
				error: result.error ?? "Unknown error",
				durationMs: result.durationMs,
				completedAt: new Date().toISOString(),
			});
		}

		if (result.conversationLog && result.conversationLog.length > 0) {
			await ctx.store.saveConversationLog(runId, result.conversationLog);
		}

		ctx.eventBus.emit({
			type: "run_updated",
			runId,
			status: result.success ? "succeeded" : "failed",
		});

		json(res, 200, { status: "accepted" });
		return true;
	}

	return false;
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
