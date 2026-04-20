/**
 * LLM cost estimation based on token usage.
 * Prices in USD per 1M tokens. Source: https://docs.anthropic.com/en/docs/about-claude/pricing
 *
 * The calculator is provider-agnostic: input/output tokens are priced from a
 * model lookup, and any `extras` on TokenUsage are priced as `tokens *
 * input_price * costMultiplier`. Adapters decide what multipliers to attach
 * (e.g. Anthropic ephemeral cache read = 0.1, cache write 5m = 1.25).
 */

import type { TokenUsage } from "../domain/ports/execution-backend.port.js";

const PRICE_TABLE: Record<string, { input: number; output: number }> = {
	// Claude 4.6
	"claude-opus-4-6-20250610": { input: 5.0, output: 25.0 },
	"claude-sonnet-4-6-20250514": { input: 3.0, output: 15.0 },

	// Claude 4.5
	"claude-opus-4-5-20250501": { input: 5.0, output: 25.0 },
	"claude-sonnet-4-5-20250514": { input: 3.0, output: 15.0 },

	// Claude 4
	"claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
	"claude-opus-4-20250514": { input: 15.0, output: 75.0 },

	// Claude Haiku
	"claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 },
};

/**
 * Prefix-based fallback — matches model IDs like "claude-sonnet-4-6-xxx"
 * that aren't in the exact table (e.g., new point releases).
 */
const PREFIX_PRICES: { prefix: string; input: number; output: number }[] = [
	{ prefix: "claude-opus-4-6", input: 5.0, output: 25.0 },
	{ prefix: "claude-opus-4-5", input: 5.0, output: 25.0 },
	{ prefix: "claude-sonnet-4-6", input: 3.0, output: 15.0 },
	{ prefix: "claude-sonnet-4-5", input: 3.0, output: 15.0 },
	{ prefix: "claude-sonnet-4", input: 3.0, output: 15.0 },
	{ prefix: "claude-opus-4", input: 15.0, output: 75.0 },
	{ prefix: "claude-haiku-4", input: 1.0, output: 5.0 },
	{ prefix: "claude-haiku-3", input: 0.25, output: 1.25 },
];

function lookupPrices(
	model: string,
): { input: number; output: number } | undefined {
	const exact = PRICE_TABLE[model];
	if (exact) return exact;
	for (const p of PREFIX_PRICES) {
		if (model.startsWith(p.prefix)) return { input: p.input, output: p.output };
	}
	return undefined;
}

/**
 * Compute total cost for a token usage breakdown in USD.
 *
 * Accepts either a plain `(model, input, output)` triple (back-compat) or a
 * `(model, TokenUsage)` pair. The latter also prices any `extras` attached
 * by the adapter — e.g. Anthropic ephemeral cache reads/writes.
 */
export function estimateCostUsd(
	model: string,
	inputTokensOrUsage: number | TokenUsage,
	outputTokens?: number,
): number {
	const prices = lookupPrices(model);
	if (!prices) return 0;

	const usage: TokenUsage =
		typeof inputTokensOrUsage === "number"
			? { inputTokens: inputTokensOrUsage, outputTokens: outputTokens ?? 0 }
			: inputTokensOrUsage;

	let cost =
		usage.inputTokens * prices.input + usage.outputTokens * prices.output;

	for (const extra of usage.extras ?? []) {
		cost += extra.tokens * prices.input * extra.costMultiplier;
	}

	return cost / 1_000_000;
}
