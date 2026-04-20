#!/usr/bin/env node
/**
 * AgentForge Platform CLI — extends core with distributed capabilities.
 * Adds: OTel SDK, PostgreSQL, Docker/remote executors, apply command,
 * node management, crash recovery, reconciliation, rate limiting.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import { registerDashboardCommand } from "agentforge-core/cli/commands/dashboard.js";
import { registerExecCommand } from "agentforge-core/cli/commands/exec.js";
import { registerGateCommand } from "agentforge-core/cli/commands/gate.js";
import { registerGetCommand } from "agentforge-core/cli/commands/get-pipeline.js";
import { registerInfoCommand } from "agentforge-core/cli/commands/info.js";
import { registerInitCommand } from "agentforge-core/cli/commands/init.js";
import { registerListCommand } from "agentforge-core/cli/commands/list.js";
import { registerLogsCommand } from "agentforge-core/cli/commands/logs.js";
import { registerRunPipelineCommand } from "agentforge-core/cli/commands/run-pipeline.js";
import { registerTemplatesCommand } from "agentforge-core/cli/commands/templates.js";
import { GateController } from "agentforge-core/control-plane/gate-controller.js";
import { PipelineController } from "agentforge-core/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "agentforge-core/control-plane/scheduler.js";
import { loadDefinitionsFromDir } from "agentforge-core/definitions/parser.js";
import { traceStateStore } from "agentforge-core/observability/traced-state-store.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { Command } from "commander";
import { SqliteDefinitionStore } from "./adapters/store/sqlite-definition-store.js";
import { registerApplyCommand } from "./cli/commands/apply.js";
import { registerNodeStartCommand } from "./cli/commands/node-start.js";
import { registerNodesCommands } from "./cli/commands/nodes.js";
import { PipelineRecoveryService } from "./control-plane/pipeline-recovery.js";
import { PipelineRateLimiter } from "./control-plane/rate-limiter.js";
import { NodeHealthChecker } from "./nodes/health-check.js";
import { LocalNodeRuntime } from "./nodes/local-runtime.js";
import { NodeRegistry } from "./nodes/registry.js";
import { SshNodeRuntime } from "./nodes/ssh-runtime.js";
import { flushTelemetry, initTelemetry } from "./observability/init.js";
import {
	getPlatformTemplatePath,
	getPlatformTemplates,
} from "./templates/registry.js";

// Initialize OTel SDK (exports traces when OTEL_EXPORTER_OTLP_ENDPOINT is set).
// Must run before any code paths that start spans, otherwise the global
// TracerProvider stays a no-op and BatchSpanProcessor never sees them.
initTelemetry({ serviceName: "agentforge" });

// Flush buffered spans on signal exits so CLI invocations don't drop traces.
// parseAsync().then(...) handles the normal success path below.
let telemetryFlushed = false;
async function shutdownTelemetry(signal: NodeJS.Signals): Promise<void> {
	if (telemetryFlushed) return;
	telemetryFlushed = true;
	try {
		await flushTelemetry();
	} finally {
		process.exit(signal === "SIGINT" ? 130 : 143);
	}
}
process.once("SIGINT", (sig) => void shutdownTelemetry(sig));
process.once("SIGTERM", (sig) => void shutdownTelemetry(sig));

// Read version from package.json. File layout: dist/platform-cli.js → ../package.json.
const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkgVersion = (
	JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }
).version;

const program = new Command();

program
	.name("agentforge")
	.description(
		"AgentForge Platform — distributed AI agent workflows with full observability",
	)
	.version(pkgVersion);

const OUTPUT_DIR = resolve(
	process.env.AGENTFORGE_OUTPUT_DIR ?? join(process.cwd(), "output"),
);

// --- Definition Store (persistent, DB-backed) ---
mkdirSync(OUTPUT_DIR, { recursive: true });
const DEFINITIONS_DB_PATH = join(OUTPUT_DIR, ".definitions.db");
const sqliteDefinitionStore = new SqliteDefinitionStore(DEFINITIONS_DB_PATH);
const definitionStore = sqliteDefinitionStore.asLegacyStore();

// Auto-load definitions from .agentforge/ directories
const AGENTFORGE_DIR = join(process.cwd(), ".agentforge");
for (const dir of ["agents", "pipelines", "nodes"]) {
	try {
		const loaded = loadDefinitionsFromDir(join(AGENTFORGE_DIR, dir));
		for (const a of loaded.agents) definitionStore.addAgent(a);
		for (const p of loaded.pipelines) definitionStore.addPipeline(p);
		for (const n of loaded.nodes) definitionStore.addNode(n);
	} catch {
		// Directory may not exist — that's fine
	}
}

// --- State Store (SQLite default, PostgreSQL via env) ---
const STATE_DB_PATH = join(OUTPUT_DIR, ".agentforge-state.db");
let stateStore: import("agentforge-core/domain/ports/state-store.port.js").IStateStore;

if (process.env.AGENTFORGE_STATE_STORE === "postgres") {
	const url = process.env.AGENTFORGE_POSTGRES_URL;
	if (!url) {
		console.error(
			"Configuration error: AGENTFORGE_STATE_STORE=postgres but AGENTFORGE_POSTGRES_URL is not set.",
		);
		console.error(
			"Set AGENTFORGE_POSTGRES_URL=postgres://user:pass@host:port/db or unset AGENTFORGE_STATE_STORE to use SQLite.",
		);
		process.exit(1);
	}
	const { PostgresStateStore } = await import("./state/pg-store.js");
	const pgStore = new PostgresStateStore(url);
	try {
		await pgStore.preflight();
		await pgStore.initialize();
	} catch (err) {
		console.error(
			`Postgres startup check failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}
	stateStore = traceStateStore(pgStore);
} else {
	stateStore = traceStateStore(new SqliteStateStore(STATE_DB_PATH));
}

// --- Control Plane (full: nodes, recovery, rate limiting) ---
const gateController = new GateController(stateStore);
const nodeRegistry = new NodeRegistry(definitionStore.listNodes(), stateStore);
const scheduler = new LocalAgentScheduler(nodeRegistry);

// Rate limiter (reads limits from pipeline YAML + env vars)
const rateLimiter = new PipelineRateLimiter(stateStore, {
	maxTokensPerPipeline: process.env.AGENTFORGE_MAX_TOKENS_PER_PIPELINE
		? Number(process.env.AGENTFORGE_MAX_TOKENS_PER_PIPELINE)
		: undefined,
	maxCostPerPipeline: process.env.AGENTFORGE_MAX_COST_PER_PIPELINE
		? Number(process.env.AGENTFORGE_MAX_COST_PER_PIPELINE)
		: undefined,
	maxConcurrentRunsPerProject: process.env
		.AGENTFORGE_MAX_CONCURRENT_RUNS_PER_PROJECT
		? Number(process.env.AGENTFORGE_MAX_CONCURRENT_RUNS_PER_PROJECT)
		: undefined,
});

// Load config up front so stopPipeline() can wire the executor into the
// controller and actually abort in-flight runs (P18-T17).
let appConfig: import("agentforge-core/di/config.js").AppConfig | undefined;
try {
	const { loadConfig } = await import("agentforge-core/di/config.js");
	appConfig = loadConfig();
} catch {
	// Config not available — dashboard runs without execution capability
}

let agentExecutor:
	| import("agentforge-core/domain/ports/agent-executor.port.js").IAgentExecutor
	| undefined;
if (appConfig) {
	const { createAgentExecutor } = await import(
		"agentforge-core/di/executor-factory.js"
	);
	agentExecutor = createAgentExecutor("local", { config: appConfig });
}

const pipelineController = new PipelineController(
	stateStore,
	gateController,
	scheduler,
	rateLimiter,
	agentExecutor,
);

const eventBus = new InMemoryEventBus();

// Crash recovery
const _recoveryService = new PipelineRecoveryService(stateStore, eventBus, {
	maxRetries: 2,
	retryBackoffMs: 5_000,
	stuckRunThresholdMs: 300_000,
	autoRehydrate: true,
});

// Node health monitoring
const { createMetricsRecorder } = await import(
	"agentforge-core/observability/metrics.js"
);
const metrics = createMetricsRecorder();
const noopBackend = {
	runAgent: async () => ({
		artifacts: [],
		tokenUsage: { inputTokens: 0, outputTokens: 0 },
		durationMs: 0,
		events: [],
	}),
};
const nodeRuntimes = definitionStore
	.listNodes()
	.map((def) =>
		def.spec.connection.type === "ssh"
			? new SshNodeRuntime(def)
			: new LocalNodeRuntime(def, noopBackend),
	);
const nodeHealthChecker = new NodeHealthChecker(
	nodeRegistry,
	nodeRuntimes,
	metrics,
);
void nodeHealthChecker.checkAll();

// Init and templates don't need the DI container — register with platform templates merged in.
registerInitCommand(program, (name: string) => getPlatformTemplatePath(name));
registerTemplatesCommand(program, getPlatformTemplates());

// --- Register all commands (core + platform) ---
registerListCommand(program);
registerInfoCommand(program);
registerExecCommand(program);
registerApplyCommand(program, definitionStore);

registerDashboardCommand(program, {
	store: stateStore,
	gateController,
	pipelineController,
	definitionStore,
	config: appConfig,
	eventBus,
	agentExecutor,
});
registerLogsCommand(program, stateStore);
registerRunPipelineCommand(program, pipelineController, stateStore);
registerGetCommand(program, stateStore);
registerGateCommand(program, stateStore, pipelineController);
registerNodesCommands(program, nodeRegistry);
registerNodeStartCommand(program);

void program.parseAsync().then(async () => {
	await stateStore.close();
	sqliteDefinitionStore.close();
	telemetryFlushed = true;
	await flushTelemetry();
});
