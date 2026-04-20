/**
 * Shared row mappers for SQLite and PostgreSQL state stores.
 * Handles both string (SQLite TEXT) and parsed object (PostgreSQL JSONB) JSON columns.
 */

import type { AgentRunRecord } from "../domain/models/agent-run.model.js";
import type { Gate } from "../domain/models/gate.model.js";
import type { NodeRecord } from "../domain/models/node.model.js";
import type { PipelineRun } from "../domain/models/pipeline-run.model.js";
import type {
	AuditLog,
	ExecutionLog,
} from "../domain/ports/state-store.port.js";

export function nullToUndefined<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value;
}

/** Parse JSON safely — handles both string (SQLite) and pre-parsed (PostgreSQL JSONB) values */
function parseJson<T>(value: unknown): T | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value === "string") return JSON.parse(value) as T;
	return value as T;
}

function parseJsonArray<T>(value: unknown): T[] {
	if (value === null || value === undefined) return [];
	if (typeof value === "string") return JSON.parse(value) as T[];
	if (Array.isArray(value)) return value as T[];
	return [];
}

export function rowToPipelineRun(row: Record<string, unknown>): PipelineRun {
	return {
		id: row.id as string,
		sessionName: (row.session_name as string) || "",
		projectName: row.project_name as string,
		pipelineName: row.pipeline_name as string,
		status: row.status as PipelineRun["status"],
		currentPhase: row.current_phase as number,
		inputs: parseJson<Record<string, string>>(row.inputs),
		version: (row.version as number) ?? 1,
		startedAt: row.started_at as string,
		completedAt: nullToUndefined(row.completed_at as string | null),
		createdAt: row.created_at as string,
	};
}

export function rowToAgentRun(row: Record<string, unknown>): AgentRunRecord {
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		agentName: row.agent_name as string,
		phase: row.phase as number,
		nodeName: row.node_name as string,
		status: row.status as AgentRunRecord["status"],
		inputArtifactIds: parseJsonArray<string>(row.input_artifact_ids),
		outputArtifactIds: parseJsonArray<string>(row.output_artifact_ids),
		tokenUsage: parseJson<{ inputTokens: number; outputTokens: number }>(
			row.token_usage,
		),
		provider: nullToUndefined(row.provider as string | null),
		modelName: nullToUndefined(row.model_name as string | null),
		costUsd: nullToUndefined(row.cost_usd as number | null),
		durationMs: nullToUndefined(row.duration_ms as number | null),
		error: nullToUndefined(row.error as string | null),
		exitReason: nullToUndefined(
			row.exit_reason as AgentRunRecord["exitReason"] | null,
		),
		revisionNotes: nullToUndefined(row.revision_notes as string | null),
		retryCount: (row.retry_count as number) ?? 0,
		recoveryToken: nullToUndefined(row.recovery_token as string | null),
		lastStatusAt: nullToUndefined(row.last_status_at as string | null),
		statusMessage: nullToUndefined(row.status_message as string | null),
		startedAt: row.started_at as string,
		completedAt: nullToUndefined(row.completed_at as string | null),
		createdAt: row.created_at as string,
	};
}

export function rowToNode(row: Record<string, unknown>): NodeRecord {
	return {
		name: row.name as string,
		type: row.type as string,
		capabilities: parseJsonArray<string>(row.capabilities),
		maxConcurrentRuns: nullToUndefined(
			row.max_concurrent_runs as number | null,
		),
		status: row.status as NodeRecord["status"],
		activeRuns: row.active_runs as number,
		lastHeartbeat: nullToUndefined(row.last_heartbeat as string | null),
		updatedAt: row.updated_at as string,
	};
}

export function rowToGate(row: Record<string, unknown>): Gate {
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		phaseCompleted: row.phase_completed as number,
		phaseNext: row.phase_next as number,
		status: row.status as Gate["status"],
		reviewer: nullToUndefined(row.reviewer as string | null),
		comment: nullToUndefined(row.comment as string | null),
		revisionNotes: nullToUndefined(row.revision_notes as string | null),
		artifactVersionIds: parseJsonArray<string>(row.artifact_version_ids),
		crossCuttingFindings: parseJson<unknown>(row.cross_cutting_findings),
		version: (row.version as number) ?? 1,
		decidedAt: nullToUndefined(row.decided_at as string | null),
		createdAt: row.created_at as string,
	};
}

export function rowToAuditLog(row: Record<string, unknown>): AuditLog {
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		actor: row.actor as string,
		action: row.action as string,
		resourceType: row.resource_type as string,
		resourceId: row.resource_id as string,
		metadata: parseJson<unknown>(row.metadata),
		createdAt: row.created_at as string,
	};
}

export function rowToExecutionLog(row: Record<string, unknown>): ExecutionLog {
	return {
		id: row.id as string,
		agentRunId: row.agent_run_id as string,
		level: row.level as string,
		message: row.message as string,
		metadata: parseJson<Record<string, unknown>>(row.metadata),
		timestamp: row.timestamp as string,
	};
}
