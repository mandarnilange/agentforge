/**
 * SqliteStateStore — SQLite-backed implementation of IStateStore.
 * Uses better-sqlite3 for synchronous, embedded SQLite access.
 */

import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { AgentRunRecord } from "../domain/models/agent-run.model.js";
import type { Gate } from "../domain/models/gate.model.js";
import type { NodeRecord } from "../domain/models/node.model.js";
import type { PipelineRun } from "../domain/models/pipeline-run.model.js";
import type { ConversationEntry } from "../domain/ports/execution-backend.port.js";
import type {
	AuditLogEntry,
	CreateAgentRunInput,
	CreateGateInput,
	CreatePipelineRunInput,
	ExecutionLog,
	ExecutionLogEntry,
	IStateStore,
} from "../domain/ports/state-store.port.js";
import { generateSessionName } from "../utils/session-name.js";
import { SCHEMA_SQL } from "./schema.js";

export class SqliteStateStore implements IStateStore {
	private readonly db: Database.Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		this.db.exec(SCHEMA_SQL);
		// Migrate existing databases incrementally
		for (const sql of [
			"ALTER TABLE agent_runs ADD COLUMN revision_notes TEXT",
			"ALTER TABLE agent_runs ADD COLUMN provider TEXT",
			"ALTER TABLE agent_runs ADD COLUMN model_name TEXT",
			"ALTER TABLE agent_runs ADD COLUMN cost_usd REAL",
			"ALTER TABLE agent_runs ADD COLUMN last_status_at TEXT",
			"ALTER TABLE agent_runs ADD COLUMN status_message TEXT",
			"ALTER TABLE agent_runs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
			"ALTER TABLE agent_runs ADD COLUMN recovery_token TEXT",
			"ALTER TABLE agent_runs ADD COLUMN exit_reason TEXT",
			"ALTER TABLE pipeline_runs ADD COLUMN inputs TEXT",
			"ALTER TABLE pipeline_runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
			"ALTER TABLE pipeline_runs ADD COLUMN session_name TEXT NOT NULL DEFAULT ''",
			"ALTER TABLE gates ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
		]) {
			try {
				this.db.prepare(sql).run();
			} catch {
				// Column already exists — safe to ignore
			}
		}
	}

	// --- Pipeline Runs ---

	async createPipelineRun(input: CreatePipelineRunInput): Promise<PipelineRun> {
		const run: PipelineRun = {
			id: randomUUID(),
			sessionName: generateSessionName(),
			projectName: input.projectName,
			pipelineName: input.pipelineName,
			status: input.status,
			currentPhase: input.currentPhase,
			inputs: input.inputs,
			version: 1,
			startedAt: input.startedAt,
			completedAt: input.completedAt,
			createdAt: new Date().toISOString(),
		};

		this.db
			.prepare(
				`
      INSERT INTO pipeline_runs (id, session_name, project_name, pipeline_name, status, current_phase, inputs, started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				run.id,
				run.sessionName,
				run.projectName,
				run.pipelineName,
				run.status,
				run.currentPhase,
				run.inputs ? JSON.stringify(run.inputs) : null,
				run.startedAt,
				run.completedAt ?? null,
				run.createdAt,
			);

		return run;
	}

	async getPipelineRun(id: string): Promise<PipelineRun | null> {
		const row = this.db
			.prepare("SELECT * FROM pipeline_runs WHERE id = ?")
			.get(id) as Record<string, unknown> | undefined;
		return row ? rowToPipelineRun(row) : null;
	}

	async listPipelineRuns(): Promise<PipelineRun[]> {
		const rows = this.db
			.prepare("SELECT * FROM pipeline_runs ORDER BY created_at DESC")
			.all() as Record<string, unknown>[];
		return rows.map(rowToPipelineRun);
	}

	async updatePipelineRun(
		id: string,
		updates: Partial<
			Pick<PipelineRun, "status" | "currentPhase" | "completedAt">
		>,
	): Promise<void> {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}
		if (updates.currentPhase !== undefined) {
			sets.push("current_phase = ?");
			values.push(updates.currentPhase);
		}
		if (updates.completedAt !== undefined) {
			sets.push("completed_at = ?");
			values.push(updates.completedAt);
		}
		if (sets.length === 0) return;
		sets.push("version = version + 1");
		values.push(id);
		this.db
			.prepare(`UPDATE pipeline_runs SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}

	// --- Agent Runs ---

	async createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRecord> {
		const run: AgentRunRecord = {
			id: randomUUID(),
			pipelineRunId: input.pipelineRunId,
			agentName: input.agentName,
			phase: input.phase,
			nodeName: input.nodeName,
			status: input.status,
			inputArtifactIds: input.inputArtifactIds,
			outputArtifactIds: input.outputArtifactIds,
			tokenUsage: input.tokenUsage,
			provider: input.provider,
			modelName: input.modelName,
			costUsd: input.costUsd,
			durationMs: input.durationMs,
			error: input.error,
			exitReason: input.exitReason,
			revisionNotes: input.revisionNotes,
			retryCount: input.retryCount ?? 0,
			recoveryToken: input.recoveryToken,
			startedAt: input.startedAt,
			completedAt: input.completedAt,
			createdAt: new Date().toISOString(),
		};

		this.db
			.prepare(
				`
      INSERT INTO agent_runs (id, pipeline_run_id, agent_name, phase, node_name, status, input_artifact_ids, output_artifact_ids, token_usage, provider, model_name, cost_usd, duration_ms, error, exit_reason, revision_notes, retry_count, recovery_token, started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				run.id,
				run.pipelineRunId,
				run.agentName,
				run.phase,
				run.nodeName,
				run.status,
				JSON.stringify(run.inputArtifactIds),
				JSON.stringify(run.outputArtifactIds),
				run.tokenUsage ? JSON.stringify(run.tokenUsage) : null,
				run.provider ?? null,
				run.modelName ?? null,
				run.costUsd ?? null,
				run.durationMs ?? null,
				run.error ?? null,
				run.exitReason ?? null,
				run.revisionNotes ?? null,
				run.retryCount ?? 0,
				run.recoveryToken ?? null,
				run.startedAt,
				run.completedAt ?? null,
				run.createdAt,
			);

		return run;
	}

	async getAgentRun(id: string): Promise<AgentRunRecord | null> {
		const row = this.db
			.prepare("SELECT * FROM agent_runs WHERE id = ?")
			.get(id) as Record<string, unknown> | undefined;
		return row ? rowToAgentRun(row) : null;
	}

	async listAgentRuns(pipelineRunId: string): Promise<AgentRunRecord[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM agent_runs WHERE pipeline_run_id = ? ORDER BY created_at ASC",
			)
			.all(pipelineRunId) as Record<string, unknown>[];
		return rows.map(rowToAgentRun);
	}

	async updateAgentRun(
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
	): Promise<void> {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}
		if (updates.startedAt !== undefined) {
			sets.push("started_at = ?");
			values.push(updates.startedAt);
		}
		if (updates.completedAt !== undefined) {
			sets.push("completed_at = ?");
			values.push(updates.completedAt);
		}
		if (updates.error !== undefined) {
			sets.push("error = ?");
			values.push(updates.error);
		}
		if (updates.exitReason !== undefined) {
			sets.push("exit_reason = ?");
			values.push(updates.exitReason);
		}
		if (updates.durationMs !== undefined) {
			sets.push("duration_ms = ?");
			values.push(updates.durationMs);
		}
		if (updates.tokenUsage !== undefined) {
			sets.push("token_usage = ?");
			values.push(JSON.stringify(updates.tokenUsage));
		}
		if (updates.outputArtifactIds !== undefined) {
			sets.push("output_artifact_ids = ?");
			values.push(JSON.stringify(updates.outputArtifactIds));
		}
		if (updates.provider !== undefined) {
			sets.push("provider = ?");
			values.push(updates.provider);
		}
		if (updates.modelName !== undefined) {
			sets.push("model_name = ?");
			values.push(updates.modelName);
		}
		if (updates.costUsd !== undefined) {
			sets.push("cost_usd = ?");
			values.push(updates.costUsd);
		}
		if (updates.lastStatusAt !== undefined) {
			sets.push("last_status_at = ?");
			values.push(updates.lastStatusAt);
		}
		if (updates.statusMessage !== undefined) {
			sets.push("status_message = ?");
			values.push(updates.statusMessage);
		}
		if (sets.length === 0) return;
		values.push(id);
		this.db
			.prepare(`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}

	// --- Nodes ---

	async upsertNode(node: NodeRecord): Promise<void> {
		this.db
			.prepare(
				`
      INSERT INTO nodes (name, type, capabilities, max_concurrent_runs, status, active_runs, last_heartbeat, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        capabilities = excluded.capabilities,
        max_concurrent_runs = excluded.max_concurrent_runs,
        status = excluded.status,
        active_runs = excluded.active_runs,
        last_heartbeat = excluded.last_heartbeat,
        updated_at = excluded.updated_at
    `,
			)
			.run(
				node.name,
				node.type,
				JSON.stringify(node.capabilities),
				node.maxConcurrentRuns ?? null,
				node.status,
				node.activeRuns,
				node.lastHeartbeat ?? null,
				node.updatedAt,
			);
	}

	async getNode(name: string): Promise<NodeRecord | null> {
		const row = this.db
			.prepare("SELECT * FROM nodes WHERE name = ?")
			.get(name) as Record<string, unknown> | undefined;
		return row ? rowToNode(row) : null;
	}

	async listNodes(): Promise<NodeRecord[]> {
		const rows = this.db
			.prepare("SELECT * FROM nodes ORDER BY name ASC")
			.all() as Record<string, unknown>[];
		return rows.map(rowToNode);
	}

	// --- Gates ---

	async createGate(input: CreateGateInput): Promise<Gate> {
		const gate: Gate = {
			id: randomUUID(),
			pipelineRunId: input.pipelineRunId,
			phaseCompleted: input.phaseCompleted,
			phaseNext: input.phaseNext,
			status: input.status,
			reviewer: input.reviewer,
			comment: input.comment,
			revisionNotes: input.revisionNotes,
			artifactVersionIds: input.artifactVersionIds,
			crossCuttingFindings: input.crossCuttingFindings,
			version: 1,
			decidedAt: input.decidedAt,
			createdAt: new Date().toISOString(),
		};

		this.db
			.prepare(
				`
      INSERT INTO gates (id, pipeline_run_id, phase_completed, phase_next, status, reviewer, comment, revision_notes, artifact_version_ids, cross_cutting_findings, decided_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				gate.id,
				gate.pipelineRunId,
				gate.phaseCompleted,
				gate.phaseNext,
				gate.status,
				gate.reviewer ?? null,
				gate.comment ?? null,
				gate.revisionNotes ?? null,
				JSON.stringify(gate.artifactVersionIds),
				gate.crossCuttingFindings
					? JSON.stringify(gate.crossCuttingFindings)
					: null,
				gate.decidedAt ?? null,
				gate.createdAt,
			);

		return gate;
	}

	async getGate(id: string): Promise<Gate | null> {
		const row = this.db.prepare("SELECT * FROM gates WHERE id = ?").get(id) as
			| Record<string, unknown>
			| undefined;
		return row ? rowToGate(row) : null;
	}

	async listGates(pipelineRunId: string): Promise<Gate[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM gates WHERE pipeline_run_id = ? ORDER BY created_at ASC",
			)
			.all(pipelineRunId) as Record<string, unknown>[];
		return rows.map(rowToGate);
	}

	async updateGate(
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
	): Promise<void> {
		const sets: string[] = [];
		const values: unknown[] = [];
		if (updates.status !== undefined) {
			sets.push("status = ?");
			values.push(updates.status);
		}
		if (updates.reviewer !== undefined) {
			sets.push("reviewer = ?");
			values.push(updates.reviewer);
		}
		if (updates.comment !== undefined) {
			sets.push("comment = ?");
			values.push(updates.comment);
		}
		if (updates.revisionNotes !== undefined) {
			sets.push("revision_notes = ?");
			values.push(updates.revisionNotes);
		}
		if (updates.decidedAt !== undefined) {
			sets.push("decided_at = ?");
			values.push(updates.decidedAt);
		}
		if (updates.crossCuttingFindings !== undefined) {
			sets.push("cross_cutting_findings = ?");
			values.push(JSON.stringify(updates.crossCuttingFindings));
		}
		if (sets.length === 0) return;
		sets.push("version = version + 1");
		values.push(id);
		this.db
			.prepare(`UPDATE gates SET ${sets.join(", ")} WHERE id = ?`)
			.run(...values);
	}

	async getPendingGate(pipelineRunId: string): Promise<Gate | null> {
		const row = this.db
			.prepare(
				"SELECT * FROM gates WHERE pipeline_run_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
			)
			.get(pipelineRunId) as Record<string, unknown> | undefined;
		return row ? rowToGate(row) : null;
	}

	// --- Audit Log ---

	async writeAuditLog(entry: AuditLogEntry): Promise<void> {
		this.db
			.prepare(
				`
      INSERT INTO audit_log (id, pipeline_run_id, actor, action, resource_type, resource_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
			)
			.run(
				randomUUID(),
				entry.pipelineRunId,
				entry.actor,
				entry.action,
				entry.resourceType,
				entry.resourceId,
				entry.metadata ? JSON.stringify(entry.metadata) : null,
				new Date().toISOString(),
			);
	}

	async listAuditLog(
		pipelineRunId?: string,
	): Promise<import("../domain/ports/state-store.port.js").AuditLog[]> {
		const rows = pipelineRunId
			? (this.db
					.prepare(
						"SELECT * FROM audit_log WHERE pipeline_run_id = ? ORDER BY created_at DESC",
					)
					.all(pipelineRunId) as Record<string, unknown>[])
			: (this.db
					.prepare("SELECT * FROM audit_log ORDER BY created_at DESC")
					.all() as Record<string, unknown>[]);
		return rows.map(rowToAuditLog);
	}

	// --- Conversation Logs ---

	async saveConversationLog(
		runId: string,
		log: ConversationEntry[],
	): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO conversation_logs (run_id, log_json) VALUES (?, ?)
       ON CONFLICT(run_id) DO UPDATE SET log_json = excluded.log_json`,
			)
			.run(runId, JSON.stringify(log));
	}

	async getConversationLog(runId: string): Promise<ConversationEntry[]> {
		const row = this.db
			.prepare("SELECT log_json FROM conversation_logs WHERE run_id = ?")
			.get(runId) as { log_json: string } | undefined;
		if (!row) return [];
		return JSON.parse(row.log_json) as ConversationEntry[];
	}

	// --- Execution Logs ---

	async writeExecutionLog(entry: ExecutionLogEntry): Promise<void> {
		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO execution_logs (id, agent_run_id, level, message, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				id,
				entry.agentRunId,
				entry.level,
				entry.message,
				entry.metadata ? JSON.stringify(entry.metadata) : null,
				entry.timestamp,
			);
	}

	async listExecutionLogs(agentRunId: string): Promise<ExecutionLog[]> {
		const rows = this.db
			.prepare(
				"SELECT * FROM execution_logs WHERE agent_run_id = ? ORDER BY timestamp ASC",
			)
			.all(agentRunId) as Record<string, unknown>[];
		return rows.map(rowToExecutionLog);
	}

	async close(): Promise<void> {
		this.db.close();
	}
}

// --- Row mappers ---

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value;
}

function rowToPipelineRun(row: Record<string, unknown>): PipelineRun {
	const inputsRaw = row.inputs as string | null;
	return {
		id: row.id as string,
		sessionName: (row.session_name as string) || "",
		projectName: row.project_name as string,
		pipelineName: row.pipeline_name as string,
		status: row.status as PipelineRun["status"],
		currentPhase: row.current_phase as number,
		inputs: inputsRaw
			? (JSON.parse(inputsRaw) as Record<string, string>)
			: undefined,
		version: (row.version as number) ?? 1,
		startedAt: row.started_at as string,
		completedAt: nullToUndefined(row.completed_at as string | null),
		createdAt: row.created_at as string,
	};
}

function rowToAgentRun(row: Record<string, unknown>): AgentRunRecord {
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		agentName: row.agent_name as string,
		phase: row.phase as number,
		nodeName: row.node_name as string,
		status: row.status as AgentRunRecord["status"],
		inputArtifactIds: JSON.parse(row.input_artifact_ids as string),
		outputArtifactIds: JSON.parse(row.output_artifact_ids as string),
		tokenUsage: row.token_usage
			? JSON.parse(row.token_usage as string)
			: undefined,
		provider: nullToUndefined(row.provider as string | null),
		modelName: nullToUndefined(row.model_name as string | null),
		costUsd: nullToUndefined(row.cost_usd as number | null),
		durationMs: nullToUndefined(row.duration_ms as number | null),
		error: nullToUndefined(row.error as string | null),
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

function rowToNode(row: Record<string, unknown>): NodeRecord {
	return {
		name: row.name as string,
		type: row.type as string,
		capabilities: JSON.parse(row.capabilities as string),
		maxConcurrentRuns: nullToUndefined(
			row.max_concurrent_runs as number | null,
		),
		status: row.status as NodeRecord["status"],
		activeRuns: row.active_runs as number,
		lastHeartbeat: nullToUndefined(row.last_heartbeat as string | null),
		updatedAt: row.updated_at as string,
	};
}

function rowToGate(row: Record<string, unknown>): Gate {
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		phaseCompleted: row.phase_completed as number,
		phaseNext: row.phase_next as number,
		status: row.status as Gate["status"],
		reviewer: nullToUndefined(row.reviewer as string | null),
		comment: nullToUndefined(row.comment as string | null),
		revisionNotes: nullToUndefined(row.revision_notes as string | null),
		artifactVersionIds: JSON.parse(row.artifact_version_ids as string),
		crossCuttingFindings: row.cross_cutting_findings
			? JSON.parse(row.cross_cutting_findings as string)
			: undefined,
		version: (row.version as number) ?? 1,
		decidedAt: nullToUndefined(row.decided_at as string | null),
		createdAt: row.created_at as string,
	};
}

function rowToExecutionLog(row: Record<string, unknown>): ExecutionLog {
	const metadataRaw = row.metadata as string | null;
	return {
		id: row.id as string,
		agentRunId: row.agent_run_id as string,
		level: row.level as string,
		message: row.message as string,
		metadata: metadataRaw
			? (JSON.parse(metadataRaw) as Record<string, unknown>)
			: undefined,
		timestamp: row.timestamp as string,
	};
}

function rowToAuditLog(
	row: Record<string, unknown>,
): import("../domain/ports/state-store.port.js").AuditLog {
	const metadataRaw = row.metadata as string | null;
	return {
		id: row.id as string,
		pipelineRunId: row.pipeline_run_id as string,
		actor: row.actor as string,
		action: row.action as string,
		resourceType: row.resource_type as string,
		resourceId: row.resource_id as string,
		metadata: metadataRaw ? JSON.parse(metadataRaw) : undefined,
		createdAt: row.created_at as string,
	};
}
