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
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "agentforge-core/definitions/parser.js";
import { loadDefinitionsFromDir } from "agentforge-core/definitions/parser.js";
import type { DefinitionStore } from "agentforge-core/definitions/store.js";
import { createDefinitionStore } from "agentforge-core/definitions/store.js";
import { traceStateStore } from "agentforge-core/observability/traced-state-store.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { Command } from "commander";
import { PgDefinitionStore } from "./adapters/store/pg-definition-store.js";
import { SqliteDefinitionStore } from "./adapters/store/sqlite-definition-store.js";
import type { DefinitionPersistSink } from "./cli/commands/apply.js";
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

mkdirSync(OUTPUT_DIR, { recursive: true });

const USE_POSTGRES = process.env.AGENTFORGE_STATE_STORE === "postgres";
const POSTGRES_URL = process.env.AGENTFORGE_POSTGRES_URL;

if (USE_POSTGRES && !POSTGRES_URL) {
	console.error(
		"Configuration error: AGENTFORGE_STATE_STORE=postgres but AGENTFORGE_POSTGRES_URL is not set.",
	);
	console.error(
		"Set AGENTFORGE_POSTGRES_URL=postgres://user:pass@host:port/db or unset AGENTFORGE_STATE_STORE to use SQLite.",
	);
	process.exit(1);
}

// --- Definition Store ---
// SQLite mode: SqliteDefinitionStore is both the runtime sync store and the
//   persistence/history store (single file on disk).
// Postgres mode: PgDefinitionStore is the persistence/history store (async);
//   the runtime sync DefinitionStore is an in-memory map populated from YAML.
//   No SQLite file is created.
const DEFINITIONS_DB_PATH = join(OUTPUT_DIR, ".definitions.db");
let sqliteDefinitionStore: SqliteDefinitionStore | null = null;
let pgDefinitionStore: PgDefinitionStore | null = null;
let definitionStore: DefinitionStore;
let applyPersistSink: DefinitionPersistSink | null = null;

// Names that PG already knows about — skipped during YAML overlay so PG
// (the source of truth across process boundaries) wins. Empty in SQLite
// mode, populated from PG hydration in PG mode.
const pgKnownAgents = new Set<string>();
const pgKnownPipelines = new Set<string>();
const pgKnownNodes = new Set<string>();

if (USE_POSTGRES) {
	const pgStore = new PgDefinitionStore(POSTGRES_URL as string);
	try {
		await pgStore.preflight();
		await pgStore.initialize();
	} catch (err) {
		console.error(
			`Postgres definition-store startup check failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}
	pgDefinitionStore = pgStore;
	definitionStore = createDefinitionStore();

	// Hydrate the in-memory runtime store from PG. PG is the source of truth
	// across process boundaries; without this, a worker (or a CP replica)
	// without local .agentforge YAML would start with an empty runtime store
	// even though PG has all the definitions.
	for (const def of await pgStore.list("AgentDefinition")) {
		const agent = JSON.parse(def.specYaml) as AgentDefinitionYaml;
		definitionStore.addAgent(agent);
		pgKnownAgents.add(agent.metadata.name);
	}
	for (const def of await pgStore.list("PipelineDefinition")) {
		const pipeline = JSON.parse(def.specYaml) as PipelineDefinitionYaml;
		definitionStore.addPipeline(pipeline);
		pgKnownPipelines.add(pipeline.metadata.name);
	}
	for (const def of await pgStore.list("NodeDefinition")) {
		const node = JSON.parse(def.specYaml) as NodeDefinitionYaml;
		definitionStore.addNode(node);
		pgKnownNodes.add(node.metadata.name);
	}

	applyPersistSink = {
		upsertAgent: (a, by) => pgStore.upsertAgent(a, by),
		upsertPipeline: (p, by) => pgStore.upsertPipeline(p, by),
		upsertNode: (n, by) => pgStore.upsertNode(n, by),
	};
} else {
	sqliteDefinitionStore = new SqliteDefinitionStore(DEFINITIONS_DB_PATH);
	definitionStore = sqliteDefinitionStore.asLegacyStore();
}

// Auto-load definitions from local .agentforge/.
//
// SQLite mode: YAML is the only persistence input — overlay always.
// PG mode: PG is the source of truth. We only seed names that PG has not
//   already persisted. To push edits to existing names, run `agentforge
//   apply -f <path>` or use the dashboard — those go through the explicit
//   write path that bumps version + writes history.
const AGENTFORGE_DIR = join(process.cwd(), ".agentforge");
for (const dir of ["agents", "pipelines", "nodes"]) {
	try {
		const loaded = loadDefinitionsFromDir(join(AGENTFORGE_DIR, dir));
		for (const a of loaded.agents) {
			if (USE_POSTGRES && pgKnownAgents.has(a.metadata.name)) continue;
			definitionStore.addAgent(a);
			if (pgDefinitionStore) await pgDefinitionStore.upsertAgent(a, "boot");
		}
		for (const p of loaded.pipelines) {
			if (USE_POSTGRES && pgKnownPipelines.has(p.metadata.name)) continue;
			definitionStore.addPipeline(p);
			if (pgDefinitionStore) await pgDefinitionStore.upsertPipeline(p, "boot");
		}
		for (const n of loaded.nodes) {
			if (USE_POSTGRES && pgKnownNodes.has(n.metadata.name)) continue;
			definitionStore.addNode(n);
			if (pgDefinitionStore) await pgDefinitionStore.upsertNode(n, "boot");
		}
	} catch {
		// Directory may not exist — that's fine
	}
}

// --- State Store (SQLite default, PostgreSQL via env) ---
const STATE_DB_PATH = join(OUTPUT_DIR, ".agentforge-state.db");
let stateStore: import("agentforge-core/domain/ports/state-store.port.js").IStateStore;

if (USE_POSTGRES) {
	const { PostgresStateStore } = await import("./state/pg-store.js");
	const pgStore = new PostgresStateStore(POSTGRES_URL as string);
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
registerApplyCommand(program, definitionStore, applyPersistSink);

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
	if (sqliteDefinitionStore) sqliteDefinitionStore.close();
	if (pgDefinitionStore) await pgDefinitionStore.close();
	telemetryFlushed = true;
	await flushTelemetry();
});
