/**
 * PipelineRecoveryService — handles crash recovery on startup.
 *
 * SAFETY PRINCIPLE: Recovery only fixes state inconsistencies.
 * It NEVER creates new agent runs or triggers execution.
 * Retries must be explicit user actions (dashboard "Retry" button).
 */

import type {
	RecoveryOptions,
	RecoveryResult,
} from "@mandarnilange/agentforge-core/domain/models/recovery.model.js";
import type { IEventBus } from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";

export class PipelineRecoveryService {
	constructor(
		private readonly store: IStateStore,
		private readonly eventBus: IEventBus,
		private readonly options: RecoveryOptions,
	) {}

	async rehydrateActivePipelines(): Promise<RecoveryResult> {
		const result: RecoveryResult = {
			rehydratedPipelines: [],
			retriedRuns: [],
			failedRuns: [],
			errors: [],
		};

		try {
			const allPipelines = await this.store.listPipelineRuns();
			const active = allPipelines.filter(
				(p) => p.status === "running" || p.status === "paused_at_gate",
			);

			for (const pipeline of active) {
				result.rehydratedPipelines.push(pipeline.id);

				// Fix zombie pipelines: if any agent failed, mark pipeline as failed
				const runs = await this.store.listAgentRuns(pipeline.id);
				const hasFailed = runs.some((r) => r.status === "failed");
				if (hasFailed && pipeline.status === "running") {
					await this.store.updatePipelineRun(pipeline.id, {
						status: "failed",
						completedAt: new Date().toISOString(),
					});

					await this.store.writeAuditLog({
						pipelineRunId: pipeline.id,
						actor: "recovery",
						action: "fail_zombie_pipeline",
						resourceType: "pipeline_run",
						resourceId: pipeline.id,
						metadata: {
							reason:
								"Pipeline had failed agent runs but was still marked as running",
						},
					});

					this.eventBus.emit({
						type: "pipeline_updated",
						pipelineRunId: pipeline.id,
						status: "failed",
					});
				}
			}
		} catch (err) {
			result.errors.push(err instanceof Error ? err.message : String(err));
		}

		return result;
	}

	/**
	 * Detects stuck agent runs and marks them as failed.
	 * Does NOT create retry runs — retries are user-initiated only.
	 */
	async detectAndFailStuckRuns(pipelineRunId: string): Promise<RecoveryResult> {
		const result: Mutable<RecoveryResult> = {
			rehydratedPipelines: [],
			retriedRuns: [],
			failedRuns: [],
			errors: [],
		};

		try {
			const runs = await this.store.listAgentRuns(pipelineRunId);
			const now = Date.now();
			const stuckRuns = runs.filter((r) => {
				if (r.status !== "running") return false;
				const lastActivity = r.lastStatusAt ?? r.startedAt;
				const age = now - new Date(lastActivity).getTime();
				return age > this.options.stuckRunThresholdMs;
			});

			for (const stuckRun of stuckRuns) {
				await this.store.updateAgentRun(stuckRun.id, {
					status: "failed",
					error:
						"Stuck run detected by recovery service — no activity within threshold",
					completedAt: new Date().toISOString(),
				});

				await this.store.writeAuditLog({
					pipelineRunId,
					actor: "recovery",
					action: "fail_stuck_run",
					resourceType: "agent_run",
					resourceId: stuckRun.id,
					metadata: {
						lastActivity: stuckRun.lastStatusAt ?? stuckRun.startedAt,
						retryCount: stuckRun.retryCount ?? 0,
					},
				});

				this.eventBus.emit({
					type: "run_updated",
					runId: stuckRun.id,
					status: "failed",
				});

				result.failedRuns.push(stuckRun.id);
			}

			// If any runs were failed, also fail the pipeline
			if (stuckRuns.length > 0) {
				await this.store.updatePipelineRun(pipelineRunId, {
					status: "failed",
					completedAt: new Date().toISOString(),
				});

				this.eventBus.emit({
					type: "pipeline_updated",
					pipelineRunId,
					status: "failed",
				});
			}
		} catch (err) {
			result.errors.push(err instanceof Error ? err.message : String(err));
		}

		return result;
	}

	async getRetryCount(
		pipelineRunId: string,
		agentName: string,
		phase: number,
	): Promise<number> {
		try {
			const runs = await this.store.listAgentRuns(pipelineRunId);
			const matching = runs.filter(
				(r) => r.agentName === agentName && r.phase === phase,
			);
			if (matching.length === 0) return 0;
			return Math.max(...matching.map((r) => r.retryCount ?? 0));
		} catch {
			return 0;
		}
	}
}

type Mutable<T> = {
	-readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K];
};
