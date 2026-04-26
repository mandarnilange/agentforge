import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { IExecutionBackend } from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";
import type {
	INodeRuntime,
	NodeRunRequest,
	NodeRunResult,
} from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";

export class LocalNodeRuntime implements INodeRuntime {
	readonly nodeDefinition: NodeDefinitionYaml;
	private readonly backend: IExecutionBackend;

	constructor(nodeDefinition: NodeDefinitionYaml, backend: IExecutionBackend) {
		this.nodeDefinition = nodeDefinition;
		this.backend = backend;
	}

	async ping(): Promise<boolean> {
		return true;
	}

	async execute(request: NodeRunRequest): Promise<NodeRunResult> {
		const start = Date.now();
		try {
			const result = await this.backend.runAgent(
				request.executionBackendRequest,
			);
			return {
				runId: request.runId,
				success: true,
				result,
				durationMs: Date.now() - start,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				runId: request.runId,
				success: false,
				error: message,
				durationMs: Date.now() - start,
			};
		}
	}
}
