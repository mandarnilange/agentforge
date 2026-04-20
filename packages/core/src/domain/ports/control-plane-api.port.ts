import type { NodeDefinitionYaml } from "../models/node-definition.model.js";
import type { NodeRunRequest, NodeRunResult } from "./node-runtime.port.js";

export interface IControlPlaneApi {
	registerNode(def: NodeDefinitionYaml): void;
	reportHeartbeat(nodeName: string, activeRuns: number): void;
	reportRunResult(runId: string, result: NodeRunResult): void;
	getPendingRuns(nodeName: string): NodeRunRequest[];
}
