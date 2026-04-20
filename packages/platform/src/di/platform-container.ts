import type {
	EventCallback,
	ProgressCallback,
} from "agentforge-core/adapters/execution/pi-ai-backend.js";
import {
	createBackendForExecutor,
	type ExecutorType,
} from "agentforge-core/di/container.js";
import type { IExecutionBackend } from "agentforge-core/domain/ports/execution-backend.port.js";
import { ProviderAwareBackend } from "../adapters/execution/provider-aware-backend.js";

export interface PlatformBackendOptions {
	onProgress?: ProgressCallback;
	onEvent?: EventCallback;
	workdir?: string;
}

/**
 * Creates an IExecutionBackend for the given executor type, wrapped with
 * provider-aware middleware that validates API keys and handles provider-specific
 * concerns (Ollama endpoint mapping, billing extras stripping).
 *
 * Executor type selects the backend (pi-ai vs pi-coding-agent).
 * Model provider (in the request) selects the LLM.
 */
export function createPlatformBackendForExecutor(
	executor: ExecutorType,
	options?: PlatformBackendOptions,
): IExecutionBackend {
	const coreBackend = createBackendForExecutor(executor, options);
	return new ProviderAwareBackend(coreBackend);
}
