import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/nodes/cost-calculator.js";

describe("estimateCostUsd", () => {
	it("returns correct USD cost for claude-sonnet-4-20250514", () => {
		// $3 per 1M input, $15 per 1M output
		const cost = estimateCostUsd(
			"claude-sonnet-4-20250514",
			1_000_000,
			1_000_000,
		);
		expect(cost).toBeCloseTo(18.0, 5);
	});

	it("returns correct USD cost for small token counts", () => {
		// 1000 input + 500 output with sonnet pricing
		const cost = estimateCostUsd("claude-sonnet-4-20250514", 1000, 500);
		expect(cost).toBeCloseTo(0.003 + 0.0075, 6);
	});

	it("returns 0 for unknown model", () => {
		const cost = estimateCostUsd("unknown-model-xyz", 10000, 5000);
		expect(cost).toBe(0);
	});

	it("returns 0 for zero tokens", () => {
		const cost = estimateCostUsd("claude-sonnet-4-20250514", 0, 0);
		expect(cost).toBe(0);
	});

	it("handles claude-opus-4-20250514 pricing", () => {
		// $15 per 1M input, $75 per 1M output
		const cost = estimateCostUsd(
			"claude-opus-4-20250514",
			1_000_000,
			1_000_000,
		);
		expect(cost).toBeCloseTo(90.0, 5);
	});

	describe("TokenUsage with provider extras", () => {
		it("prices Anthropic cache reads at 0.1× input rate", () => {
			// Sonnet input $3/1M → cache read $0.30/1M
			const cost = estimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 0,
				outputTokens: 0,
				extras: [
					{
						kind: "anthropic.cacheRead",
						tokens: 1_000_000,
						costMultiplier: 0.1,
					},
				],
			});
			expect(cost).toBeCloseTo(0.3, 5);
		});

		it("prices Anthropic cache writes (5m) at 1.25× input rate", () => {
			// Sonnet input $3/1M → cache write 5m $3.75/1M
			const cost = estimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 0,
				outputTokens: 0,
				extras: [
					{
						kind: "anthropic.cacheWrite5m",
						tokens: 1_000_000,
						costMultiplier: 1.25,
					},
				],
			});
			expect(cost).toBeCloseTo(3.75, 5);
		});

		it("sums input + output + extras in a single usage object", () => {
			// Real-world shape: 2 input, 7497 cache write 5m, 0 cache read, some output
			const cost = estimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 2,
				outputTokens: 100,
				extras: [
					{
						kind: "anthropic.cacheWrite5m",
						tokens: 7497,
						costMultiplier: 1.25,
					},
					{ kind: "anthropic.cacheRead", tokens: 0, costMultiplier: 0.1 },
				],
			});
			// 2*3 + 100*15 + 7497*3*1.25 + 0 = 6 + 1500 + 28113.75 = 29619.75 / 1e6
			expect(cost).toBeCloseTo(29619.75 / 1_000_000, 8);
		});

		it("ignores unknown extras gracefully (applies multiplier as declared)", () => {
			// An unrecognized kind still gets priced using its declared multiplier —
			// this keeps the calculator provider-agnostic.
			const cost = estimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 0,
				outputTokens: 0,
				extras: [{ kind: "openai.reasoning", tokens: 1000, costMultiplier: 2 }],
			});
			// 1000 * 3 * 2 / 1e6 = 0.006
			expect(cost).toBeCloseTo(0.006, 6);
		});

		it("back-compat: (model, input, output) signature still works", () => {
			const cost = estimateCostUsd("claude-sonnet-4-20250514", 1000, 500);
			expect(cost).toBeCloseTo(0.003 + 0.0075, 6);
		});

		it("no extras means same cost as plain input/output", () => {
			const a = estimateCostUsd("claude-sonnet-4-20250514", 1000, 500);
			const b = estimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 1000,
				outputTokens: 500,
			});
			expect(a).toBeCloseTo(b, 10);
		});
	});
});
