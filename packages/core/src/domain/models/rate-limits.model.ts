/**
 * Domain models for pipeline rate limiting and cost controls.
 * ZERO external dependencies.
 */

export interface PipelineLimits {
	readonly maxTokensPerPipeline?: number;
	readonly maxCostPerPipeline?: number;
	readonly maxConcurrentRunsPerProject?: number;
}

export type LimitViolationType = "tokens" | "cost" | "concurrent_runs";

export interface LimitViolation {
	readonly type: LimitViolationType;
	readonly limit: number;
	readonly actual: number;
	readonly message: string;
}
