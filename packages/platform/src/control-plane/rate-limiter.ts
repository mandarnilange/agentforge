/**
 * PipelineRateLimiter — enforces token, cost, and concurrency limits.
 * Checks are performed before scheduling new agent runs.
 */

import type {
	LimitViolation,
	PipelineLimits,
} from "@mandarnilange/agentforge-core/domain/models/rate-limits.model.js";
import type { IRateLimiter } from "@mandarnilange/agentforge-core/domain/ports/rate-limiter.port.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";

export class PipelineRateLimiter implements IRateLimiter {
	constructor(
		private readonly store: IStateStore,
		private readonly defaultLimits: PipelineLimits,
	) {}

	async checkLimits(pipelineRunId: string): Promise<LimitViolation[]> {
		const violations: LimitViolation[] = [];
		const limits = this.defaultLimits;

		const pipeline = await this.store.getPipelineRun(pipelineRunId);
		if (!pipeline) return violations;

		// Token limit check
		if (limits.maxTokensPerPipeline !== undefined) {
			const runs = await this.store.listAgentRuns(pipelineRunId);
			let totalTokens = 0;
			for (const run of runs) {
				if (run.tokenUsage) {
					totalTokens +=
						run.tokenUsage.inputTokens + run.tokenUsage.outputTokens;
				}
			}
			if (totalTokens > limits.maxTokensPerPipeline) {
				violations.push({
					type: "tokens",
					limit: limits.maxTokensPerPipeline,
					actual: totalTokens,
					message: `Total tokens (${totalTokens}) exceeds limit (${limits.maxTokensPerPipeline})`,
				});
			}
		}

		// Cost limit check
		if (limits.maxCostPerPipeline !== undefined) {
			const runs = await this.store.listAgentRuns(pipelineRunId);
			let totalCost = 0;
			for (const run of runs) {
				if (run.costUsd !== undefined) {
					totalCost += run.costUsd;
				}
			}
			if (totalCost > limits.maxCostPerPipeline) {
				violations.push({
					type: "cost",
					limit: limits.maxCostPerPipeline,
					actual: totalCost,
					message: `Total cost ($${totalCost.toFixed(2)}) exceeds limit ($${limits.maxCostPerPipeline.toFixed(2)})`,
				});
			}
		}

		// Concurrent runs limit check
		if (limits.maxConcurrentRunsPerProject !== undefined) {
			const allPipelines = await this.store.listPipelineRuns();
			const activeSameProject = allPipelines.filter(
				(p) =>
					p.projectName === pipeline.projectName &&
					(p.status === "running" || p.status === "paused_at_gate"),
			);
			if (activeSameProject.length > limits.maxConcurrentRunsPerProject) {
				violations.push({
					type: "concurrent_runs",
					limit: limits.maxConcurrentRunsPerProject,
					actual: activeSameProject.length,
					message: `Concurrent runs (${activeSameProject.length}) exceeds limit (${limits.maxConcurrentRunsPerProject})`,
				});
			}
		}

		return violations;
	}
}
