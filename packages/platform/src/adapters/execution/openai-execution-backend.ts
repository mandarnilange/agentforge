import {
	type EventCallback,
	PiAiExecutionBackend,
	type ProgressCallback,
} from "@mandarnilange/agentforge-core/adapters/execution/pi-ai-backend.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";

export interface OpenAiExecutionBackendOptions {
	onProgress?: ProgressCallback;
	onEvent?: EventCallback;
	delegateBackend?: IExecutionBackend;
}

export class OpenAiExecutionBackend implements IExecutionBackend {
	private readonly delegate: IExecutionBackend;

	constructor(options?: OpenAiExecutionBackendOptions) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OPENAI_API_KEY environment variable is required for OpenAI execution backend",
			);
		}

		this.delegate =
			options?.delegateBackend ??
			new PiAiExecutionBackend({
				onProgress: options?.onProgress,
				onEvent: options?.onEvent,
			});
	}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const openaiRequest: AgentRunRequest = {
			...request,
			model: {
				...request.model,
				provider: "openai",
			},
		};

		return this.delegate.runAgent(openaiRequest);
	}
}
