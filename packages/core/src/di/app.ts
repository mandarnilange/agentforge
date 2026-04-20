/**
 * Composition root for the core CLI app.
 *
 * Wires together the state store, control-plane services, definition store,
 * and event bus so that entry points (cli/index.ts) can remain thin launchers.
 */

import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { InMemoryEventBus } from "../adapters/events/in-memory-event-bus.js";
import { GateController } from "../control-plane/gate-controller.js";
import { PipelineController } from "../control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "../control-plane/scheduler.js";
import { loadDefinitionsFromDir } from "../definitions/parser.js";
import {
	createDefinitionStore,
	type DefinitionStore,
} from "../definitions/store.js";
import type { IAgentExecutor } from "../domain/ports/agent-executor.port.js";
import type { IEventBus } from "../domain/ports/event-bus.port.js";
import type { IStateStore } from "../domain/ports/state-store.port.js";
import { traceStateStore } from "../observability/traced-state-store.js";
import { resolveAgentforgeDir } from "./agentforge-dir.js";
import type { AppConfig } from "./config.js";
import { createStateStore } from "./state-store-factory.js";

export interface CoreApp {
	readonly stateStore: IStateStore;
	readonly gateController: GateController;
	readonly scheduler: LocalAgentScheduler;
	readonly pipelineController: PipelineController;
	readonly definitionStore: DefinitionStore;
	readonly eventBus: IEventBus;
	readonly appConfig?: AppConfig;
	readonly outputDir: string;
	readonly agentExecutor?: IAgentExecutor;
}

export interface CreateCoreAppOptions {
	readonly outputDir?: string;
	readonly agentforgeDir?: string;
	readonly stateDbPath?: string;
}

function resolveCliBinName(): string {
	const entry = basename(process.argv[1] ?? "");
	return entry === "platform-cli.js" ? "agentforge" : "agentforge-core";
}

/**
 * Wires the full core application from config/env.
 *
 * - Loads YAML definitions from .agentforge/{agents,pipelines,nodes}
 * - Creates the SQLite state store under the output directory
 * - Instantiates control-plane controllers (gate, scheduler, pipeline)
 * - Tries to load AppConfig; dashboard falls back to read-only without it
 */
export async function createCoreApp(
	options: CreateCoreAppOptions = {},
): Promise<CoreApp> {
	const outputDir = resolve(
		options.outputDir ??
			process.env.AGENTFORGE_OUTPUT_DIR ??
			join(process.cwd(), "output"),
	);
	const agentforgeDir = resolveAgentforgeDir(options.agentforgeDir);
	const stateDbPath =
		options.stateDbPath ?? join(outputDir, ".agentforge-state.db");
	mkdirSync(outputDir, { recursive: true });

	const definitionStore = createDefinitionStore();
	for (const dir of ["agents", "pipelines", "nodes"]) {
		try {
			const loaded = loadDefinitionsFromDir(join(agentforgeDir, dir));
			for (const a of loaded.agents) definitionStore.addAgent(a);
			for (const p of loaded.pipelines) definitionStore.addPipeline(p);
			for (const n of loaded.nodes) definitionStore.addNode(n);
		} catch {
			// Directory may not exist — that's fine
		}
	}

	// Warn on empty definitions — points the user at the init command.
	const cliBin = resolveCliBinName();
	if (definitionStore.listAgents().length === 0) {
		console.warn(
			`Warning: No agents found in ${join(agentforgeDir, "agents")}. ` +
				`Run '${cliBin} init' or add agent YAMLs to get started.`,
		);
	}
	if (definitionStore.listPipelines().length === 0) {
		console.warn(
			`Warning: No pipelines found in ${join(agentforgeDir, "pipelines")}. ` +
				`Run '${cliBin} init' or add pipeline YAMLs to wire agents together.`,
		);
	}

	const rawStore = createStateStore({ sqlitePath: stateDbPath });
	const stateStore = traceStateStore(rawStore);
	const gateController = new GateController(stateStore);
	const scheduler = new LocalAgentScheduler();
	const eventBus = new InMemoryEventBus();

	let appConfig: AppConfig | undefined;
	try {
		const { loadConfig } = await import("./config.js");
		appConfig = loadConfig();
	} catch {
		// Config not available — dashboard runs without execution capability
		console.warn(
			"Warning: ANTHROPIC_API_KEY not found — dashboard started in read-only mode. Agent execution is disabled.",
		);
	}

	// Build the executor so stopPipeline() can actually cancel in-flight runs.
	// If config isn't available (no API key), fall back to a controller without
	// an executor — the dashboard is still usable for read-only views.
	let executor: IAgentExecutor | undefined;
	if (appConfig) {
		const { createAgentExecutor } = await import("./executor-factory.js");
		executor = createAgentExecutor("local", { config: appConfig });
	}
	const pipelineController = new PipelineController(
		stateStore,
		gateController,
		scheduler,
		undefined,
		executor,
	);

	return {
		stateStore,
		gateController,
		scheduler,
		pipelineController,
		definitionStore,
		eventBus,
		appConfig,
		outputDir,
		agentExecutor: executor,
	};
}
