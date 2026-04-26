/**
 * ReconciliationLoop — the "controller-manager" that compares actual state
 * with desired state and takes corrective action.
 *
 * Detects:
 * - Agent runs stuck in "running" with no status update (executor timeout)
 * - Orphaned pipelines with no active work
 *
 * This is the safety net backing the event-driven flow.
 */

import type { IEventBus } from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";
import type { PipelineRecoveryService } from "./pipeline-recovery.js";

export interface ReconcilerOptions {
	staleRunTimeoutMs: number; // default: 60_000
}

export interface ReconciliationResult {
	staleRunsDetected: number;
	retriedRuns: number;
	failedRuns: number;
	errors: string[];
}

export class ReconciliationLoop {
	private intervalHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly store: IStateStore,
		private readonly eventBus: IEventBus,
		private readonly options: ReconcilerOptions,
		private readonly recoveryService?: PipelineRecoveryService,
	) {}

	start(intervalMs = 15_000): void {
		this.intervalHandle = setInterval(() => {
			void this.reconcile();
		}, intervalMs);
	}

	stop(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	async reconcile(): Promise<ReconciliationResult> {
		const result: ReconciliationResult = {
			staleRunsDetected: 0,
			retriedRuns: 0,
			failedRuns: 0,
			errors: [],
		};

		try {
			if (this.recoveryService) {
				await this.detectAndRecoverStaleRuns(result);
			} else {
				await this.detectStaleRuns(result);
			}
		} catch (err) {
			result.errors.push(err instanceof Error ? err.message : String(err));
		}

		return result;
	}

	private async detectStaleRuns(result: ReconciliationResult): Promise<void> {
		const pipelines = await this.store.listPipelineRuns();
		const now = Date.now();

		for (const pipeline of pipelines) {
			if (pipeline.status !== "running") continue;

			const runs = await this.store.listAgentRuns(pipeline.id);
			const runningRuns = runs.filter((r) => r.status === "running");

			for (const run of runningRuns) {
				// Use lastStatusAt if available, otherwise fall back to startedAt
				const lastActivity = run.lastStatusAt ?? run.startedAt;
				const age = now - new Date(lastActivity).getTime();

				if (age > this.options.staleRunTimeoutMs) {
					const timeoutSec = Math.round(age / 1000);
					const error = `executor timeout (no status for ${timeoutSec}s)`;

					await this.store.updateAgentRun(run.id, {
						status: "failed",
						error,
						completedAt: new Date().toISOString(),
					});

					await this.store.writeAuditLog({
						pipelineRunId: pipeline.id,
						actor: "reconciler",
						action: "fail_stale_run",
						resourceType: "agent_run",
						resourceId: run.id,
						metadata: { error, ageMs: age },
					});

					this.eventBus.emit({
						type: "run_updated",
						runId: run.id,
						status: "failed",
					});

					result.staleRunsDetected++;
				}
			}
		}
	}

	private async detectAndRecoverStaleRuns(
		result: ReconciliationResult,
	): Promise<void> {
		if (!this.recoveryService) return;
		const pipelines = await this.store.listPipelineRuns();

		for (const pipeline of pipelines) {
			if (pipeline.status !== "running") continue;

			const recoveryResult = await this.recoveryService.detectAndFailStuckRuns(
				pipeline.id,
			);
			result.staleRunsDetected +=
				recoveryResult.retriedRuns.length + recoveryResult.failedRuns.length;
			result.retriedRuns += recoveryResult.retriedRuns.length;
			result.failedRuns += recoveryResult.failedRuns.length;
			result.errors.push(...recoveryResult.errors);
		}
	}
}
