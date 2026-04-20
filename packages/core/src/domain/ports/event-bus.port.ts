/**
 * IEventBus — ephemeral pub/sub for real-time notifications.
 * NOT a persistence layer — the state store is the source of truth.
 * Subscribers: SSE endpoint (dashboard), reconciler logging.
 * Emitters: PipelineController, GateController, NodeHealthMonitor.
 *
 * ZERO external dependencies.
 */

import type { StatusUpdate } from "./agent-executor.port.js";

export type PipelineEvent =
	| { type: "pipeline_updated"; pipelineRunId: string; status: string }
	| {
			type: "run_updated";
			runId: string;
			status: string;
			statusUpdate?: StatusUpdate;
	  }
	| { type: "gate_opened"; gateId: string; pipelineRunId: string }
	| { type: "gate_decided"; gateId: string; decision: string }
	| { type: "node_online"; nodeName: string }
	| { type: "node_degraded"; nodeName: string }
	| { type: "node_offline"; nodeName: string };

export interface IEventBus {
	emit(event: PipelineEvent): void;
	subscribe(listener: (event: PipelineEvent) => void): () => void;
}
