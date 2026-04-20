/**
 * Domain model for a pipeline run instance.
 * ZERO external dependencies.
 */

export type PipelineRunStatus =
	| "running"
	| "paused_at_gate"
	| "completed"
	| "failed"
	| "cancelled";

export interface PipelineRun {
	readonly id: string;
	readonly sessionName: string;
	readonly projectName: string;
	readonly pipelineName: string;
	readonly status: PipelineRunStatus;
	readonly currentPhase: number;
	readonly inputs?: Record<string, string>;
	readonly version: number;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly createdAt: string;
}
