import type { NodeDefinitionYaml } from "../models/node-definition.model.js";
import type {
	AgentRunRequest,
	AgentRunResult,
} from "./execution-backend.port.js";

export interface NodeRunRequest {
	readonly runId: string;
	readonly agentName: string;
	readonly executionBackendRequest: AgentRunRequest;
}

export interface NodeRunResult {
	readonly runId: string;
	readonly success: boolean;
	readonly result?: AgentRunResult;
	readonly error?: string;
	readonly durationMs: number;
}

export interface INodeRuntime {
	readonly nodeDefinition: NodeDefinitionYaml;
	execute(request: NodeRunRequest): Promise<NodeRunResult>;
	ping(): Promise<boolean>;
}
