/**
 * PostgresStateStore — PostgreSQL-backed implementation of IStateStore.
 * Uses the `pg` package with connection pooling.
 */

import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRecord } from "agentforge-core/domain/models/agent-run.model.js";
import type { Gate } from "agentforge-core/domain/models/gate.model.js";
import type { NodeRecord } from "agentforge-core/domain/models/node.model.js";
import type { PipelineRun } from "agentforge-core/domain/models/pipeline-run.model.js";
import type { ConversationEntry } from "agentforge-core/domain/ports/execution-backend.port.js";
import type {
	AuditLogEntry,
	CreateAgentRunInput,
	CreateGateInput,
	CreatePipelineRunInput,
	ExecutionLog,
	ExecutionLogEntry,
	IStateStore,
} from "agentforge-core/domain/ports/state-store.port.js";
import {
	rowToAgentRun,
	rowToAuditLog,
	rowToExecutionLog,
	rowToGate,
	rowToNode,
	rowToPipelineRun,
} from "agentforge-core/state/row-mappers.js";
import { generateSessionName } from "agentforge-core/utils/session-name.js";
import pg from "pg";
import { applyPgMigrations } from "./pg-migrate.js";

const PG_MIGRATIONS_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"migrations",
	"postgres",
);

export class PostgresStateStore implements IStateStore {
	private readonly pool: pg.Pool;

	constructor(connectionString: string) {
		this.pool = new pg.Pool({ connectionString });
	}

	async initialize(): Promise<void> {
		await applyPgMigrations(this.pool, PG_MIGRATIONS_DIR);
	}

	/**
	 * Lightweight preflight — runs SELECT 1 to verify the connection string
	 * and credentials before the app binds its ports. Throws a plain Error
	 * with a clear message when the DB is unreachable so callers can print
	 * a friendly hint instead of a raw pg stack trace (P40-T4).
	 */
	async preflight(): Promise<void> {
		try {
			await this.pool.query("SELECT 1");
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Postgres preflight failed: ${reason}. ` +
					"Check AGENTFORGE_POSTGRES_URL (format: postgres://user:pass@host:port/db) and that the server is reachable.",
			);
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

		await this.pool.query(
			`INSERT INTO pipeline_runs (id, session_name, project_name, pipeline_name, status, current_phase, inputs, started_at, completed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			[
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
			],
		);

		return run;
	}

	async getPipelineRun(id: string): Promise<PipelineRun | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM pipeline_runs WHERE id = $1",
			[id],
		);
		return rows.length > 0 ? rowToPipelineRun(rows[0]) : null;
	}

	async listPipelineRuns(): Promise<PipelineRun[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM pipeline_runs ORDER BY created_at DESC",
		);
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
		let paramIdx = 1;
		if (updates.status !== undefined) {
			sets.push(`status = $${paramIdx++}`);
			values.push(updates.status);
		}
		if (updates.currentPhase !== undefined) {
			sets.push(`current_phase = $${paramIdx++}`);
			values.push(updates.currentPhase);
		}
		if (updates.completedAt !== undefined) {
			sets.push(`completed_at = $${paramIdx++}`);
			values.push(updates.completedAt);
		}
		if (sets.length === 0) return;
		sets.push("version = version + 1");
		values.push(id);
		await this.pool.query(
			`UPDATE pipeline_runs SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
			values,
		);
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

		await this.pool.query(
			`INSERT INTO agent_runs (id, pipeline_run_id, agent_name, phase, node_name, status, input_artifact_ids, output_artifact_ids, token_usage, provider, model_name, cost_usd, duration_ms, error, exit_reason, revision_notes, retry_count, recovery_token, started_at, completed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
			[
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
			],
		);

		return run;
	}

	async getAgentRun(id: string): Promise<AgentRunRecord | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM agent_runs WHERE id = $1",
			[id],
		);
		return rows.length > 0 ? rowToAgentRun(rows[0]) : null;
	}

	async listAgentRuns(pipelineRunId: string): Promise<AgentRunRecord[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM agent_runs WHERE pipeline_run_id = $1 ORDER BY created_at ASC",
			[pipelineRunId],
		);
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
		let paramIdx = 1;
		if (updates.status !== undefined) {
			sets.push(`status = $${paramIdx++}`);
			values.push(updates.status);
		}
		if (updates.startedAt !== undefined) {
			sets.push(`started_at = $${paramIdx++}`);
			values.push(updates.startedAt);
		}
		if (updates.completedAt !== undefined) {
			sets.push(`completed_at = $${paramIdx++}`);
			values.push(updates.completedAt);
		}
		if (updates.error !== undefined) {
			sets.push(`error = $${paramIdx++}`);
			values.push(updates.error);
		}
		if (updates.exitReason !== undefined) {
			sets.push(`exit_reason = $${paramIdx++}`);
			values.push(updates.exitReason);
		}
		if (updates.durationMs !== undefined) {
			sets.push(`duration_ms = $${paramIdx++}`);
			values.push(updates.durationMs);
		}
		if (updates.tokenUsage !== undefined) {
			sets.push(`token_usage = $${paramIdx++}`);
			values.push(JSON.stringify(updates.tokenUsage));
		}
		if (updates.outputArtifactIds !== undefined) {
			sets.push(`output_artifact_ids = $${paramIdx++}`);
			values.push(JSON.stringify(updates.outputArtifactIds));
		}
		if (updates.provider !== undefined) {
			sets.push(`provider = $${paramIdx++}`);
			values.push(updates.provider);
		}
		if (updates.modelName !== undefined) {
			sets.push(`model_name = $${paramIdx++}`);
			values.push(updates.modelName);
		}
		if (updates.costUsd !== undefined) {
			sets.push(`cost_usd = $${paramIdx++}`);
			values.push(updates.costUsd);
		}
		if (updates.lastStatusAt !== undefined) {
			sets.push(`last_status_at = $${paramIdx++}`);
			values.push(updates.lastStatusAt);
		}
		if (updates.statusMessage !== undefined) {
			sets.push(`status_message = $${paramIdx++}`);
			values.push(updates.statusMessage);
		}
		if (sets.length === 0) return;
		values.push(id);
		await this.pool.query(
			`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
			values,
		);
	}

	// --- Nodes ---

	async upsertNode(node: NodeRecord): Promise<void> {
		await this.pool.query(
			`INSERT INTO nodes (name, type, capabilities, max_concurrent_runs, status, active_runs, last_heartbeat, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(name) DO UPDATE SET
         type = EXCLUDED.type,
         capabilities = EXCLUDED.capabilities,
         max_concurrent_runs = EXCLUDED.max_concurrent_runs,
         status = EXCLUDED.status,
         active_runs = EXCLUDED.active_runs,
         last_heartbeat = EXCLUDED.last_heartbeat,
         updated_at = EXCLUDED.updated_at`,
			[
				node.name,
				node.type,
				JSON.stringify(node.capabilities),
				node.maxConcurrentRuns ?? null,
				node.status,
				node.activeRuns,
				node.lastHeartbeat ?? null,
				node.updatedAt,
			],
		);
	}

	async getNode(name: string): Promise<NodeRecord | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM nodes WHERE name = $1",
			[name],
		);
		return rows.length > 0 ? rowToNode(rows[0]) : null;
	}

	async listNodes(): Promise<NodeRecord[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM nodes ORDER BY name ASC",
		);
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

		await this.pool.query(
			`INSERT INTO gates (id, pipeline_run_id, phase_completed, phase_next, status, reviewer, comment, revision_notes, artifact_version_ids, cross_cutting_findings, decided_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			[
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
			],
		);

		return gate;
	}

	async getGate(id: string): Promise<Gate | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM gates WHERE id = $1",
			[id],
		);
		return rows.length > 0 ? rowToGate(rows[0]) : null;
	}

	async listGates(pipelineRunId: string): Promise<Gate[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM gates WHERE pipeline_run_id = $1 ORDER BY created_at ASC",
			[pipelineRunId],
		);
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
		let paramIdx = 1;
		if (updates.status !== undefined) {
			sets.push(`status = $${paramIdx++}`);
			values.push(updates.status);
		}
		if (updates.reviewer !== undefined) {
			sets.push(`reviewer = $${paramIdx++}`);
			values.push(updates.reviewer);
		}
		if (updates.comment !== undefined) {
			sets.push(`comment = $${paramIdx++}`);
			values.push(updates.comment);
		}
		if (updates.revisionNotes !== undefined) {
			sets.push(`revision_notes = $${paramIdx++}`);
			values.push(updates.revisionNotes);
		}
		if (updates.decidedAt !== undefined) {
			sets.push(`decided_at = $${paramIdx++}`);
			values.push(updates.decidedAt);
		}
		if (updates.crossCuttingFindings !== undefined) {
			sets.push(`cross_cutting_findings = $${paramIdx++}`);
			values.push(JSON.stringify(updates.crossCuttingFindings));
		}
		if (sets.length === 0) return;
		sets.push("version = version + 1");
		values.push(id);
		await this.pool.query(
			`UPDATE gates SET ${sets.join(", ")} WHERE id = $${paramIdx}`,
			values,
		);
	}

	async getPendingGate(pipelineRunId: string): Promise<Gate | null> {
		const { rows } = await this.pool.query(
			"SELECT * FROM gates WHERE pipeline_run_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
			[pipelineRunId],
		);
		return rows.length > 0 ? rowToGate(rows[0]) : null;
	}

	// --- Audit Log ---

	async writeAuditLog(entry: AuditLogEntry): Promise<void> {
		await this.pool.query(
			`INSERT INTO audit_log (id, pipeline_run_id, actor, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				randomUUID(),
				entry.pipelineRunId,
				entry.actor,
				entry.action,
				entry.resourceType,
				entry.resourceId,
				entry.metadata ? JSON.stringify(entry.metadata) : null,
				new Date().toISOString(),
			],
		);
	}

	async listAuditLog(
		pipelineRunId?: string,
	): Promise<
		import("agentforge-core/domain/ports/state-store.port.js").AuditLog[]
	> {
		const { rows } = pipelineRunId
			? await this.pool.query(
					"SELECT * FROM audit_log WHERE pipeline_run_id = $1 ORDER BY created_at DESC",
					[pipelineRunId],
				)
			: await this.pool.query(
					"SELECT * FROM audit_log ORDER BY created_at DESC",
				);
		return rows.map(rowToAuditLog);
	}

	// --- Conversation Logs ---

	async saveConversationLog(
		runId: string,
		log: ConversationEntry[],
	): Promise<void> {
		await this.pool.query(
			`INSERT INTO conversation_logs (run_id, log_json) VALUES ($1, $2)
       ON CONFLICT (run_id) DO UPDATE SET log_json = $2`,
			[runId, JSON.stringify(log)],
		);
	}

	async getConversationLog(runId: string): Promise<ConversationEntry[]> {
		const { rows } = await this.pool.query(
			"SELECT log_json FROM conversation_logs WHERE run_id = $1",
			[runId],
		);
		if (rows.length === 0) return [];
		const raw = rows[0].log_json;
		return typeof raw === "string"
			? (JSON.parse(raw) as ConversationEntry[])
			: (raw as ConversationEntry[]);
	}

	// --- Execution Logs ---

	async writeExecutionLog(entry: ExecutionLogEntry): Promise<void> {
		await this.pool.query(
			`INSERT INTO execution_logs (id, agent_run_id, level, message, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				randomUUID(),
				entry.agentRunId,
				entry.level,
				entry.message,
				entry.metadata ? JSON.stringify(entry.metadata) : null,
				entry.timestamp,
			],
		);
	}

	async listExecutionLogs(agentRunId: string): Promise<ExecutionLog[]> {
		const { rows } = await this.pool.query(
			"SELECT * FROM execution_logs WHERE agent_run_id = $1 ORDER BY timestamp ASC",
			[agentRunId],
		);
		return rows.map(rowToExecutionLog);
	}

	// --- Lifecycle ---

	async close(): Promise<void> {
		await this.pool.end();
	}
}
