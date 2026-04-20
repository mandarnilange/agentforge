import { existsSync, readFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DashboardResourceService } from "../application/dashboard/resource-service.js";
import type { GateController } from "../control-plane/gate-controller.js";
import type { PipelineController } from "../control-plane/pipeline-controller.js";
import type { DefinitionStore } from "../definitions/store.js";
import type { AgentJob } from "../domain/ports/agent-executor.port.js";
import type { IEventBus } from "../domain/ports/event-bus.port.js";
import type { IStateStore } from "../domain/ports/state-store.port.js";
import {
	handleApiRoute,
	handlePost,
	json,
	type PipelineExecutor,
	type ServerContext,
} from "./routes/api-routes.js";
import { handleControlPlaneRoute } from "./routes/control-plane-routes.js";
import { registerSSERoutes } from "./routes/sse-routes.js";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Compiled layout: dist/dashboard/server.js — SPA at dist/dashboard/app/.
// Dev layout: src/dashboard/server.ts — SPA at src/dashboard/dist/ (Vite output).
const DIST_DIR_COMPILED = resolve(__dirname, "app");
const DIST_DIR_SRC_FALLBACK = resolve(__dirname, "dist");
const DIST_DIR = existsSync(DIST_DIR_COMPILED)
	? DIST_DIR_COMPILED
	: DIST_DIR_SRC_FALLBACK;

export type { PipelineExecutor };

export interface DashboardServerOptions {
	store: IStateStore;
	eventBus?: IEventBus;
	gateController?: GateController;
	pipelineController?: PipelineController;
	definitionStore?: DefinitionStore;
	executePipeline?: PipelineExecutor;
	/** Config outputDir for resolving live conversation sidecars. */
	outputDir?: string;
	/** Per-node pending run queues for the control-plane polling dispatch flow. */
	pendingRunQueues?: Map<string, AgentJob[]>;
}

export function createDashboardServer(
	storeOrOpts: IStateStore | DashboardServerOptions,
	gateController?: GateController,
): Server {
	const opts: DashboardServerOptions =
		"store" in storeOrOpts &&
		typeof (storeOrOpts as DashboardServerOptions).store === "object" &&
		"listPipelineRuns" in ((storeOrOpts as DashboardServerOptions).store ?? {})
			? (storeOrOpts as DashboardServerOptions)
			: { store: storeOrOpts as IStateStore, gateController };

	const service = new DashboardResourceService(
		opts.store,
		opts.definitionStore,
		{ outputDir: opts.outputDir },
	);
	const ctx: ServerContext = {
		service,
		gateController: opts.gateController,
		pipelineController: opts.pipelineController,
		definitionStore: opts.definitionStore,
		executePipeline: opts.executePipeline,
	};
	const eventBus = opts.eventBus;
	const pendingRunQueues = opts.pendingRunQueues;
	return createServer((req, res) => {
		void handleRequest(req, res, ctx, eventBus, pendingRunQueues, opts.store);
	});
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	ctx: ServerContext,
	eventBus: IEventBus | undefined,
	pendingRunQueues: Map<string, AgentJob[]> | undefined,
	store: IStateStore,
): Promise<void> {
	const method = req.method ?? "GET";
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = url.pathname;

	// Control-plane routes for worker registration, heartbeat, pending-runs,
	// and result reporting. These need store+eventBus and sit ahead of the
	// generic POST/GET dispatchers so they get first shot at /api/v1/nodes/*
	// and /api/v1/runs/*/result paths.
	if (eventBus) {
		const handled = await handleControlPlaneRoute(req, res, {
			store,
			eventBus,
			pendingRunQueues,
		});
		if (handled) return;
	}

	if (method === "POST") {
		await handlePost(req, res, path, ctx);
		return;
	}

	if (method !== "GET") {
		json(res, 405, { error: "Method not allowed" });
		return;
	}

	// SSE endpoint for real-time events
	if (path === "/api/v1/events" && eventBus) {
		registerSSERoutes(req, res, eventBus);
		return;
	}

	// API routes
	if (path.startsWith("/api/")) {
		await handleApiRoute(path, url, res, ctx);
		return;
	}

	// Static file serving for React SPA
	serveStatic(path, res);
}

function serveStatic(urlPath: string, res: ServerResponse): void {
	// Try exact file match first (for /assets/index-xxx.js, /assets/index-xxx.css)
	const safePath = urlPath.replace(/\.\./g, "");
	const filePath = join(DIST_DIR, safePath);

	if (safePath !== "/" && existsSync(filePath)) {
		const ext = extname(filePath);
		const mime = MIME_TYPES[ext] ?? "application/octet-stream";
		res.statusCode = 200;
		res.setHeader("content-type", mime);
		if (ext === ".js" || ext === ".css") {
			res.setHeader("cache-control", "public, max-age=31536000, immutable");
		}
		res.end(readFileSync(filePath));
		return;
	}

	// SPA fallback: serve index.html for all non-file routes
	const indexPath = join(DIST_DIR, "index.html");
	if (existsSync(indexPath)) {
		res.statusCode = 200;
		res.setHeader("content-type", "text/html; charset=utf-8");
		res.end(readFileSync(indexPath));
		return;
	}

	// No built dashboard — serve legacy error or minimal HTML
	res.statusCode = 404;
	res.setHeader("content-type", "text/plain; charset=utf-8");
	res.end(
		"Dashboard assets not found. Please run 'npm run build' in src/dashboard/app.",
	);
}
