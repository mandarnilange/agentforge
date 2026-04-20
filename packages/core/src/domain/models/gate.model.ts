/**
 * Domain model for a human approval gate.
 * ZERO external dependencies.
 */

export type GateStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "revision_requested";

export interface Gate {
	readonly id: string;
	readonly pipelineRunId: string;
	readonly phaseCompleted: number;
	readonly phaseNext: number;
	readonly status: GateStatus;
	readonly reviewer?: string;
	readonly comment?: string;
	readonly revisionNotes?: string;
	readonly artifactVersionIds: string[];
	readonly crossCuttingFindings?: unknown;
	readonly version: number;
	readonly decidedAt?: string;
	readonly createdAt: string;
}
