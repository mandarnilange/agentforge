import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

interface ProviderConfig {
	envVar?: string;
	envVarLabel: string;
	setupEnv?: () => void;
	mapProvider?: string;
	stripBillingExtras?: boolean;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
	openai: {
		envVar: "OPENAI_API_KEY",
		envVarLabel: "OPENAI_API_KEY",
	},
	google: {
		envVar: "GOOGLE_API_KEY",
		envVarLabel: "GOOGLE_API_KEY",
	},
	ollama: {
		envVarLabel: "OLLAMA_BASE_URL (optional)",
		setupEnv: () => {
			const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
			if (!process.env.OPENAI_BASE_URL) {
				process.env.OPENAI_BASE_URL = `${baseUrl}/v1`;
			}
			if (!process.env.OPENAI_API_KEY) {
				process.env.OPENAI_API_KEY = "ollama";
			}
		},
		mapProvider: "openai",
		stripBillingExtras: true,
	},
};

export class ProviderAwareBackend implements IExecutionBackend {
	constructor(private readonly delegate: IExecutionBackend) {}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const provider = request.model.provider;
		const config = PROVIDER_CONFIGS[provider];

		if (config) {
			// Validate required env var
			if (config.envVar && !process.env[config.envVar]) {
				throw new Error(
					`${config.envVar} environment variable is required for provider "${provider}"`,
				);
			}

			// Run provider-specific env setup
			config.setupEnv?.();
		}

		// Map provider if needed (e.g., ollama → openai for OpenAI-compatible API)
		const mappedRequest: AgentRunRequest = config?.mapProvider
			? {
					...request,
					model: { ...request.model, provider: config.mapProvider },
				}
			: request;

		const result = await this.delegate.runAgent(mappedRequest);

		// Strip billing extras for free providers (e.g., ollama)
		if (config?.stripBillingExtras) {
			return {
				...result,
				tokenUsage: {
					inputTokens: result.tokenUsage.inputTokens,
					outputTokens: result.tokenUsage.outputTokens,
				},
			};
		}

		return result;
	}
}

export function getProviderConfig(
	provider: string,
): ProviderConfig | undefined {
	return PROVIDER_CONFIGS[provider];
}

export function getSupportedProviders(): string[] {
	return Object.keys(PROVIDER_CONFIGS);
}
