/**
 * DI Container — wires adapters to domain ports.
 */

import { join } from "node:path";
import {
	type EventCallback,
	PiAiExecutionBackend,
	type ProgressCallback,
} from "../adapters/execution/pi-ai-backend.js";
import { PiCodingAgentExecutionBackend } from "../adapters/execution/pi-coding-agent-backend.js";
import { PinoLogger } from "../adapters/observability/pino-logger.adapter.js";
import { FilePromptLoader } from "../adapters/prompt/file-prompt.adapter.js";
import { FsArtifactStore } from "../adapters/store/fs-artifact.adapter.js";
import type { IArtifactStore } from "../domain/ports/artifact-store.port.js";
import type { IExecutionBackend } from "../domain/ports/execution-backend.port.js";
import type { ILogger } from "../domain/ports/logger.port.js";
import type { IPromptLoader } from "../domain/ports/prompt-loader.port.js";
import { TracedExecutionBackend } from "../observability/traced-execution-backend.js";
import { setDiscoveredSchemas } from "../schemas/index.js";
import { discoverSchemas } from "../schemas/schema-discovery.js";
import { resolveAgentforgeDir } from "./agentforge-dir.js";
import type { AppConfig } from "./config.js";

function wireSchemas(): void {
	const schemasDir = join(resolveAgentforgeDir(), "schemas");
	try {
		setDiscoveredSchemas(discoverSchemas(schemasDir));
	} catch {
		// Non-fatal: if .agentforge/schemas/ is absent or malformed, fall back to Zod validators
	}
}

export type ExecutorType = "pi-ai" | "pi-coding-agent";

export interface Container {
	executionBackend: IExecutionBackend;
	artifactStore: IArtifactStore;
	promptLoader: IPromptLoader;
	logger: ILogger;
	config: AppConfig;
}

/**
 * Returns the appropriate IExecutionBackend for a given executor type.
 * - "pi-ai" -> PiAiExecutionBackend (document-producing agents)
 * - "pi-coding-agent" -> PiCodingAgentExecutionBackend (code-producing agents)
 */
export function createBackendForExecutor(
	executor: ExecutorType,
	options?: {
		onProgress?: ProgressCallback;
		onEvent?: EventCallback;
		workdir?: string;
		agentforgeDir?: string;
	},
): IExecutionBackend {
	let backend: IExecutionBackend;
	switch (executor) {
		case "pi-coding-agent":
			backend = new PiCodingAgentExecutionBackend({
				onProgress: options?.onProgress,
				onEvent: options?.onEvent,
				workdir: options?.workdir,
				agentforgeDir: options?.agentforgeDir ?? resolveAgentforgeDir(),
			});
			break;
		default:
			backend = new PiAiExecutionBackend({
				onProgress: options?.onProgress,
				onEvent: options?.onEvent,
			});
			break;
	}
	return new TracedExecutionBackend(backend);
}

export function createContainer(
	config: AppConfig,
	options?: { onProgress?: ProgressCallback; onEvent?: EventCallback },
): Container {
	wireSchemas();
	const logger = new PinoLogger({ level: config.logLevel });
	const executionBackend = new TracedExecutionBackend(
		new PiAiExecutionBackend({
			onProgress: options?.onProgress,
			onEvent: options?.onEvent,
		}),
	);
	const artifactStore = new FsArtifactStore();
	const promptLoader = new FilePromptLoader(config.promptsDir);

	return {
		executionBackend,
		artifactStore,
		promptLoader,
		logger,
		config,
	};
}

/**
 * Creates a Container with the correct execution backend for a specific agent.
 * Reads the executor type and selects PiAi or PiCodingAgent backend accordingly.
 */
export function createContainerForAgent(
	executor: ExecutorType,
	config: AppConfig,
	options?: {
		onProgress?: ProgressCallback;
		onEvent?: EventCallback;
		workdir?: string;
		agentforgeDir?: string;
	},
): Container {
	wireSchemas();
	const logger = new PinoLogger({ level: config.logLevel });
	const executionBackend = createBackendForExecutor(executor, options);
	const artifactStore = new FsArtifactStore();
	const promptLoader = new FilePromptLoader(config.promptsDir);

	return {
		executionBackend,
		artifactStore,
		promptLoader,
		logger,
		config,
	};
}
