import {
	type EventCallback,
	PiAiExecutionBackend,
	type ProgressCallback,
} from "agentforge-core/adapters/execution/pi-ai-backend.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";

export interface OllamaExecutionBackendOptions {
	onProgress?: ProgressCallback;
	onEvent?: EventCallback;
	delegateBackend?: IExecutionBackend;
}

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export class OllamaExecutionBackend implements IExecutionBackend {
	private readonly delegate: IExecutionBackend;
	readonly baseUrl: string;

	constructor(options?: OllamaExecutionBackendOptions) {
		this.baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;

		// Set OPENAI_BASE_URL for OpenAI-compatible API if not already set
		if (!process.env.OPENAI_BASE_URL) {
			process.env.OPENAI_BASE_URL = `${this.baseUrl}/v1`;
		}

		// Ollama doesn't need a real API key but the OpenAI-compatible layer expects one
		if (!process.env.OPENAI_API_KEY) {
			process.env.OPENAI_API_KEY = "ollama";
		}

		this.delegate =
			options?.delegateBackend ??
			new PiAiExecutionBackend({
				onProgress: options?.onProgress,
				onEvent: options?.onEvent,
			});
	}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const ollamaRequest: AgentRunRequest = {
			...request,
			model: {
				...request.model,
				provider: "openai",
			},
		};

		const result = await this.delegate.runAgent(ollamaRequest);

		// Strip billing extras — local models are free
		return {
			...result,
			tokenUsage: {
				inputTokens: result.tokenUsage.inputTokens,
				outputTokens: result.tokenUsage.outputTokens,
			},
		};
	}
}
