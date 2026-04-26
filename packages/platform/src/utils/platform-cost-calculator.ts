import type { TokenUsage } from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";
import { estimateCostUsd } from "@mandarnilange/agentforge-core/utils/cost-calculator.js";

const PLATFORM_PRICE_TABLE: Record<string, { input: number; output: number }> =
	{
		// OpenAI
		"gpt-4o": { input: 2.5, output: 10.0 },
		"gpt-4o-mini": { input: 0.15, output: 0.6 },
		o1: { input: 15.0, output: 60.0 },
		"o1-mini": { input: 1.1, output: 4.4 },
		"o1-pro": { input: 150.0, output: 600.0 },

		// Gemini
		"gemini-2.5-pro": { input: 1.25, output: 10.0 },
		"gemini-2.5-flash": { input: 0.15, output: 0.6 },
		"gemini-2.0-flash": { input: 0.1, output: 0.4 },
	};

const PLATFORM_PREFIX_PRICES: {
	prefix: string;
	input: number;
	output: number;
}[] = [
	{ prefix: "gpt-4o", input: 2.5, output: 10.0 },
	{ prefix: "gpt-4", input: 2.5, output: 10.0 },
	{ prefix: "o1", input: 15.0, output: 60.0 },
	{ prefix: "gemini-2.5-pro", input: 1.25, output: 10.0 },
	{ prefix: "gemini-2.5-flash", input: 0.15, output: 0.6 },
	{ prefix: "gemini-2.0", input: 0.1, output: 0.4 },
];

function lookupPlatformPrices(
	model: string,
): { input: number; output: number } | undefined {
	const exact = PLATFORM_PRICE_TABLE[model];
	if (exact) return exact;
	for (const p of PLATFORM_PREFIX_PRICES) {
		if (model.startsWith(p.prefix)) return { input: p.input, output: p.output };
	}
	return undefined;
}

export function platformEstimateCostUsd(
	model: string,
	usage: TokenUsage,
): number {
	// Try platform price table first (OpenAI, Gemini)
	const prices = lookupPlatformPrices(model);
	if (prices) {
		let cost =
			usage.inputTokens * prices.input + usage.outputTokens * prices.output;

		for (const extra of usage.extras ?? []) {
			cost += extra.tokens * prices.input * extra.costMultiplier;
		}

		return cost / 1_000_000;
	}

	// Fall back to core calculator (Claude models)
	return estimateCostUsd(model, usage);
}
