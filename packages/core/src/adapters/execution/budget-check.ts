/**
 * Shared budget-checking utility for execution backends.
 * Used by both PiAiExecutionBackend and PiCodingAgentExecutionBackend.
 */

import type { Budget } from "../../domain/ports/execution-backend.port.js";

export type { Budget };

/** Model input/output pricing per 1M tokens (USD). */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> =
	{
		"claude-sonnet-4-20250514": { inputPerM: 3.0, outputPerM: 15.0 },
		"claude-opus-4-20250514": { inputPerM: 15.0, outputPerM: 75.0 },
		"claude-haiku-4-5-20251001": { inputPerM: 0.8, outputPerM: 4.0 },
	};

const DEFAULT_PRICING = { inputPerM: 3.0, outputPerM: 15.0 };

/** Compute estimated cost in USD from token usage and model name. */
export function computeCostUsd(
	usage: { inputTokens: number; outputTokens: number },
	modelName: string,
): number {
	const pricing = MODEL_PRICING[modelName] ?? DEFAULT_PRICING;
	return (
		(usage.inputTokens * pricing.inputPerM +
			usage.outputTokens * pricing.outputPerM) /
		1_000_000
	);
}

export interface BudgetCheckResult {
	exceeded: boolean;
	reason?: string;
}

/**
 * Check whether accumulated usage has exceeded the budget limits.
 * Token limit is evaluated first; cost limit second.
 */
export function checkBudget(
	totalTokens: number,
	costUsd: number,
	budget: Budget,
): BudgetCheckResult {
	if (
		budget.maxTotalTokens !== undefined &&
		totalTokens >= budget.maxTotalTokens
	) {
		return {
			exceeded: true,
			reason: `Token budget exceeded: ${totalTokens.toLocaleString()} / ${budget.maxTotalTokens.toLocaleString()} tokens`,
		};
	}
	if (budget.maxCostUsd !== undefined && costUsd >= budget.maxCostUsd) {
		return {
			exceeded: true,
			reason: `Cost budget exceeded: $${costUsd.toFixed(4)} / $${budget.maxCostUsd.toFixed(4)}`,
		};
	}
	return { exceeded: false };
}
