import type {
	EventCallback,
	ProgressCallback,
} from "@mandarnilange/agentforge-core/adapters/execution/pi-ai-backend.js";
import type { IExecutionBackend } from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";

export interface BackendFactoryOptions {
	onProgress?: ProgressCallback;
	onEvent?: EventCallback;
	workdir?: string;
}

export type BackendFactory = (
	options?: BackendFactoryOptions,
) => IExecutionBackend;

export class BackendRegistry {
	private readonly factories = new Map<string, BackendFactory>();

	register(executorType: string, factory: BackendFactory): void {
		this.factories.set(executorType, factory);
	}

	resolve(
		executorType: string,
		options?: BackendFactoryOptions,
	): IExecutionBackend | undefined {
		const factory = this.factories.get(executorType);
		if (!factory) return undefined;
		return factory(options);
	}

	listTypes(): string[] {
		return [...this.factories.keys()];
	}
}
