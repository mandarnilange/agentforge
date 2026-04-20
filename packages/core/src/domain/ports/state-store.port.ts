/**
 * IStateStore — single source of truth for all pipeline state.
 * Implementations: SqliteStateStore (MVP), PostgresStateStore (future).
 * All methods are async to support both sync (SQLite) and async (PostgreSQL) backends.
 */

import type { AgentRunRecord } from "../models/agent-run.model.js";
import type { Gate } from "../models/gate.model.js";
import type { NodeRecord } from "../models/node.model.js";
import type { PipelineRun } from "../models/pipeline-run.model.js";
import type { ConversationEntry } from "./execution-backend.port.js";

export type CreatePipelineRunInput = Omit<
	PipelineRun,
	"id" | "sessionName" | "createdAt" | "version"
>;
export type CreateAgentRunInput = Omit<AgentRunRecord, "id" | "createdAt"> & {
	revisionNotes?: string;
	retryCount?: number;
	recoveryToken?: string;
};
export type CreateGateInput = Omit<Gate, "id" | "createdAt" | "version">;

export interface AuditLogEntry {
	pipelineRunId: string;
	actor: string;
	action: string;
	resourceType: string;
	resourceId: string;
	metadata?: unknown;
}

export interface AuditLog {
	id: string;
	pipelineRunId: string;
	actor: string;
	action: string;
	resourceType: string;
	resourceId: string;
	metadata?: unknown;
	createdAt: string;
}

export interface IStateStore {
	// Pipeline runs
	createPipelineRun(input: CreatePipelineRunInput): Promise<PipelineRun>;
	getPipelineRun(id: string): Promise<PipelineRun | null>;
	listPipelineRuns(): Promise<PipelineRun[]>;
	updatePipelineRun(
		id: string,
		updates: Partial<
			Pick<PipelineRun, "status" | "currentPhase" | "completedAt">
		>,
	): Promise<void>;

	// Agent runs
	createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRecord>;
	getAgentRun(id: string): Promise<AgentRunRecord | null>;
	listAgentRuns(pipelineRunId: string): Promise<AgentRunRecord[]>;
	updateAgentRun(
		id: string,
		updates: Partial<
			Pick<
				AgentRunRecord,
				| "status"
				| "startedAt"
				| "completedAt"
				| "error"
				| "exitReason"
				| "durationMs"
				| "tokenUsage"
				| "outputArtifactIds"
				| "provider"
				| "modelName"
				| "costUsd"
				| "lastStatusAt"
				| "statusMessage"
			>
		>,
	): Promise<void>;

	// Nodes
	upsertNode(node: NodeRecord): Promise<void>;
	getNode(name: string): Promise<NodeRecord | null>;
	listNodes(): Promise<NodeRecord[]>;

	// Gates
	createGate(input: CreateGateInput): Promise<Gate>;
	getGate(id: string): Promise<Gate | null>;
	listGates(pipelineRunId: string): Promise<Gate[]>;
	updateGate(
		id: string,
		updates: Partial<
			Pick<
				Gate,
				| "status"
				| "reviewer"
				| "comment"
				| "revisionNotes"
				| "decidedAt"
				| "crossCuttingFindings"
			>
		>,
	): Promise<void>;
	getPendingGate(pipelineRunId: string): Promise<Gate | null>;

	// Audit log
	writeAuditLog(entry: AuditLogEntry): Promise<void>;
	listAuditLog(pipelineRunId?: string): Promise<AuditLog[]>;

	// Conversation logs
	saveConversationLog(runId: string, log: ConversationEntry[]): Promise<void>;
	getConversationLog(runId: string): Promise<ConversationEntry[]>;

	// Execution logs
	writeExecutionLog(entry: ExecutionLogEntry): Promise<void>;
	listExecutionLogs(agentRunId: string): Promise<ExecutionLog[]>;

	// Lifecycle
	close(): Promise<void>;
}

export interface ExecutionLogEntry {
	agentRunId: string;
	level: "info" | "warn" | "error" | "debug";
	message: string;
	metadata?: Record<string, unknown>;
	timestamp: string;
}

export interface ExecutionLog {
	id: string;
	agentRunId: string;
	level: string;
	message: string;
	metadata?: Record<string, unknown>;
	timestamp: string;
}
