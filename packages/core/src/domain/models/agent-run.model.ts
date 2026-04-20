/**
 * Domain model for a single agent execution record.
 * ZERO external dependencies.
 */

export type AgentRunRecordStatus =
	| "pending"
	| "scheduled"
	| "running"
	| "succeeded"
	| "failed";

/**
 * Why a failed/succeeded agent run ended the way it did. Only populated
 * when the reason is non-obvious (success is implicit for status="succeeded").
 * See ADR-0003 for the taxonomy and rationale.
 */
export type AgentRunExitReason =
	| "timeout"
	| "budget-tokens"
	| "budget-cost"
	| "cancelled"
	| "error";

export interface AgentRunRecord {
	readonly id: string;
	readonly pipelineRunId: string;
	readonly agentName: string;
	readonly phase: number;
	readonly nodeName: string;
	readonly status: AgentRunRecordStatus;
	readonly inputArtifactIds: string[];
	readonly outputArtifactIds: string[];
	readonly tokenUsage?: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		/**
		 * Provider-specific extra token buckets (Anthropic cache read/write,
		 * OpenAI reasoning, Gemini thinking, etc.). See TokenUsageExtra in
		 * execution-backend.port.ts for the shape.
		 */
		readonly extras?: ReadonlyArray<{
			readonly kind: string;
			readonly tokens: number;
			readonly costMultiplier: number;
		}>;
	};
	readonly provider?: string;
	readonly modelName?: string;
	readonly costUsd?: number;
	readonly durationMs?: number;
	readonly error?: string;
	/** ADR-0003 — why the run ended (optional; absent = unspecified). */
	readonly exitReason?: AgentRunExitReason;
	readonly revisionNotes?: string;
	readonly retryCount?: number;
	readonly recoveryToken?: string;
	readonly lastStatusAt?: string;
	readonly statusMessage?: string;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly createdAt: string;
	/** Token budget from the agent definition (populated at read time). */
	readonly budgetTokens?: number;
	/** Cost budget (USD) from the agent definition (populated at read time). */
	readonly budgetCostUsd?: number;
	/** Display name from agent YAML metadata.displayName (populated at read time). */
	readonly displayName?: string;
	/** Human-role equivalent from agent YAML metadata.humanEquivalent (populated at read time). */
	readonly humanEquivalent?: string;
}
