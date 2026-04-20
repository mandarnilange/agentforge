/**
 * Executor factory — creates a local IAgentExecutor for core package.
 */

import { LocalAgentExecutor } from "../adapters/execution/local-agent-executor.js";
import type { IAgentExecutor } from "../domain/ports/agent-executor.port.js";
import { TracedAgentExecutor } from "../observability/traced-agent-executor.js";
import type { AppConfig } from "./config.js";
import { createContainerForAgent } from "./container.js";

export type ExecutorMode = "local";

export interface ExecutorOptions {
	config: AppConfig;
}

export function createAgentExecutor(
	_mode: ExecutorMode,
	options: ExecutorOptions,
): IAgentExecutor {
	const { config } = options;
	const executor = new LocalAgentExecutor({
		createContainerFn: (executorType, workdir, onEvent) =>
			createContainerForAgent(executorType, config, { workdir, onEvent }),
	});
	return new TracedAgentExecutor(executor);
}
