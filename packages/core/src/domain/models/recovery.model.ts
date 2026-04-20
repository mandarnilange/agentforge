/**
 * Domain models for pipeline crash recovery.
 * ZERO external dependencies.
 */

export interface RecoveryOptions {
	readonly maxRetries: number;
	readonly retryBackoffMs: number;
	readonly stuckRunThresholdMs: number;
	readonly autoRehydrate: boolean;
}

export const DEFAULT_RECOVERY_OPTIONS: RecoveryOptions = {
	maxRetries: 2,
	retryBackoffMs: 5_000,
	stuckRunThresholdMs: 300_000,
	autoRehydrate: true,
};

export interface RecoveryResult {
	readonly rehydratedPipelines: string[];
	readonly retriedRuns: string[];
	readonly failedRuns: string[];
	readonly errors: string[];
}
