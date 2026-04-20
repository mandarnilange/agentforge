export interface DashboardSummary {
	pipelineCount: number;
	runningPipelines: number;
	pausedPipelines: number;
	nodeCount: number;
	onlineNodes: number;
	pendingGates: number;
	runCount: number;
	totalCostUsd: number;
}

export interface PipelineRun {
	id: string;
	sessionName: string;
	projectName: string;
	pipelineName: string;
	status: "running" | "paused_at_gate" | "completed" | "failed" | "cancelled";
	currentPhase: number;
	startedAt: string;
	completedAt?: string;
	createdAt: string;
}

export interface AgentRunRecord {
	id: string;
	pipelineRunId: string;
	agentName: string;
	phase: number;
	nodeName: string;
	status: "pending" | "scheduled" | "running" | "succeeded" | "failed";
	inputArtifactIds: string[];
	outputArtifactIds: string[];
	tokenUsage?: {
		inputTokens: number;
		outputTokens: number;
		extras?: Array<{
			kind: string;
			tokens: number;
			costMultiplier: number;
		}>;
	};
	provider?: string;
	modelName?: string;
	costUsd?: number;
	durationMs?: number;
	error?: string;
	/** ADR-0003 — why the run ended (e.g. "timeout"). Absent when unspecified. */
	exitReason?:
		| "timeout"
		| "budget-tokens"
		| "budget-cost"
		| "cancelled"
		| "error";
	revisionNotes?: string;
	startedAt: string;
	completedAt?: string;
	createdAt: string;
	lastActivityAt?: string;
	/** Token budget from agent definition, populated at read time. */
	budgetTokens?: number;
	/** Cost budget (USD) from agent definition, populated at read time. */
	budgetCostUsd?: number;
	/** Display name from agent YAML, populated at read time. */
	displayName?: string;
	/** Human-role equivalent from agent YAML, populated at read time. */
	humanEquivalent?: string;
}

export interface Gate {
	id: string;
	pipelineRunId: string;
	phaseCompleted: number;
	phaseNext: number;
	status: "pending" | "approved" | "rejected" | "revision_requested";
	reviewer?: string;
	comment?: string;
	revisionNotes?: string;
	artifactVersionIds: string[];
	decidedAt?: string;
	createdAt: string;
}

export interface PhaseSummary {
	phase: number;
	/** Phase name from the pipeline definition; falls back to `Phase N` when absent. */
	name?: string;
	status: string;
	runs: number;
	expectedAgents?: string[];
}

export interface PipelineDetail {
	run: PipelineRun;
	runs: AgentRunRecord[];
	gates: Gate[];
	phaseSummary: PhaseSummary[];
}

export interface NodeRecord {
	name: string;
	type: string;
	capabilities: string[];
	maxConcurrentRuns?: number;
	status: "online" | "offline" | "unknown" | "degraded";
	activeRuns: number;
	lastHeartbeat?: string;
	updatedAt: string;
}

export interface ArtifactResource {
	path: string;
	preview: string;
}

export interface ArtifactContent {
	path: string;
	content: unknown;
}

export interface PipelineDefinitionSummary {
	name: string;
	displayName: string;
	description: string;
	inputs: Array<{
		name: string;
		type: string;
		description?: string;
		required?: boolean;
	}>;
}

export interface PendingGate extends Gate {
	projectName: string;
	pipelineName: string;
	/** Name of the phase just completed, from pipeline definition. */
	phaseCompletedName?: string;
	/** Name of the next phase to run, from pipeline definition. */
	phaseNextName?: string;
}

export interface CostSummary {
	totalCostUsd: number;
	byPipeline: Array<{ id: string; name: string; cost: number }>;
	byAgent: Array<{ name: string; cost: number }>;
	byModel: Array<{ provider: string; model: string; cost: number }>;
}

export interface AuditLogEntry {
	id: string;
	pipelineRunId: string;
	actor: string;
	action: string;
	resourceType: string;
	resourceId: string;
	metadata?: unknown;
	createdAt: string;
}

export interface ConversationEntry {
	role: "user" | "assistant" | "tool_call" | "tool_result";
	content: string;
	name?: string;
	timestamp?: number;
}
