/**
 * IAgentExecutor — the boundary between Control Plane and Execution Plane.
 * Control plane sends AgentJob, receives AgentJobResult + StatusUpdate stream.
 * See ADR-0001: design/adr/0001-executor-control-plane-separation.md
 *
 * ZERO external dependencies.
 */

import type { AgentRunExitReason } from "../models/agent-run.model.js";
import type { ArtifactData } from "../models/artifact.model.js";
import type {
	ConversationEntry,
	TokenUsage,
} from "./execution-backend.port.js";

/**
 * A complete job description sent from control plane to executor.
 * Contains everything the executor needs — no back-references to control plane.
 */
export interface AgentJob {
	readonly runId: string;
	readonly agentId: string;
	readonly agentDefinition: AgentJobDefinition;
	readonly inputs: readonly ArtifactData[];
	readonly workdir: string;
	readonly outputDir: string;
	readonly model: {
		readonly provider: string;
		readonly name: string;
		readonly maxTokens: number;
	};
	readonly revisionNotes?: string;
	readonly identity?: AgentJobIdentity;
}

/** Access control token — the ServiceAccount equivalent for agent runs. */
export interface AgentJobIdentity {
	readonly agentId: string;
	readonly pipelineRunId: string;
	readonly phase: number;
	readonly allowedInputTypes: readonly string[];
	readonly allowedOutputTypes: readonly string[];
	readonly secretRefs?: readonly string[];
}

/**
 * Subset of AgentDefinitionYaml needed by executor.
 * Avoids importing the full YAML parser type into the domain layer.
 */
export interface AgentJobDefinition {
	readonly metadata: {
		readonly name: string;
		readonly [key: string]: unknown;
	};
	readonly spec?: {
		readonly executor?: string;
		readonly [key: string]: unknown;
	};
	readonly [key: string]: unknown;
}

/** The result returned by an executor after completing (or failing) an agent job. */
export interface AgentJobResult {
	readonly status: "succeeded" | "failed";
	readonly artifacts: readonly ArtifactData[];
	readonly savedFiles: readonly string[];
	readonly tokenUsage: TokenUsage;
	readonly costUsd: number;
	readonly durationMs: number;
	readonly conversationLog: readonly ConversationEntry[];
	readonly error?: string;
	/**
	 * ADR-0003 — why the run ended (absent when status === "succeeded" or
	 * when the failure reason is unspecified). Surfaces to the dashboard
	 * so operators can distinguish timeouts from generic errors.
	 */
	readonly exitReason?: AgentRunExitReason;
}

/** Discriminated type for status update events emitted during execution. */
export type StatusUpdateType =
	| "started"
	| "progress"
	| "step_started"
	| "step_completed"
	| "completed"
	| "failed"
	| "conversation_entry";

/**
 * A structured status event streamed from executor to control plane.
 *
 * For type === "conversation_entry", the `conversationEntry` field carries the
 * incremental message fragment (text delta, tool call, tool result). This lets
 * the control plane persist conversation logs incrementally so dashboards can
 * show live agent output.
 */
export interface StatusUpdate {
	readonly type: StatusUpdateType;
	readonly runId: string;
	readonly step?: string;
	readonly message?: string;
	readonly tokensGenerated?: number;
	readonly conversationEntry?: ConversationEntry;
	readonly timestamp: number;
}

/**
 * The executor interface — the boundary between Control Plane and Execution Plane.
 * Control plane calls execute() and receives streaming status updates via
 * onStatus callback. cancel() is REQUIRED: all executors must support aborting
 * an in-flight run so Stop in the UI translates into real cancellation.
 */
export interface IAgentExecutor {
	execute(
		job: AgentJob,
		onStatus?: (update: StatusUpdate) => void,
	): Promise<AgentJobResult>;
	cancel(runId: string): Promise<void>;
}
