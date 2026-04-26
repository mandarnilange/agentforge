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

export interface GeminiExecutionBackendOptions {
	onProgress?: ProgressCallback;
	onEvent?: EventCallback;
	delegateBackend?: IExecutionBackend;
}

export class GeminiExecutionBackend implements IExecutionBackend {
	private readonly delegate: IExecutionBackend;

	constructor(options?: GeminiExecutionBackendOptions) {
		if (!process.env.GOOGLE_API_KEY) {
			throw new Error(
				"GOOGLE_API_KEY environment variable is required for Gemini execution backend",
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
		const geminiRequest: AgentRunRequest = {
			...request,
			model: {
				...request.model,
				provider: "google",
			},
		};

		return this.delegate.runAgent(geminiRequest);
	}
}
