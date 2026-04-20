import { describe, expect, it } from "vitest";
import {
	checkBudget,
	computeCostUsd,
} from "../../src/adapters/execution/budget-check.js";

describe("checkBudget", () => {
	it("returns not exceeded when no limits set", () => {
		const result = checkBudget(999_999, 999.0, {});
		expect(result.exceeded).toBe(false);
		expect(result.reason).toBeUndefined();
	});

	it("returns not exceeded when tokens under maxTotalTokens", () => {
		const result = checkBudget(50_000, 0.5, { maxTotalTokens: 150_000 });
		expect(result.exceeded).toBe(false);
	});

	it("returns exceeded when tokens equal to maxTotalTokens", () => {
		const result = checkBudget(150_000, 0.5, { maxTotalTokens: 150_000 });
		expect(result.exceeded).toBe(true);
		expect(result.reason).toMatch(/150,000/);
	});

	it("returns exceeded when tokens over maxTotalTokens", () => {
		const result = checkBudget(160_000, 0.5, { maxTotalTokens: 150_000 });
		expect(result.exceeded).toBe(true);
	});

	it("returns not exceeded when cost under maxCostUsd", () => {
		const result = checkBudget(50_000, 0.1, { maxCostUsd: 0.15 });
		expect(result.exceeded).toBe(false);
	});

	it("returns exceeded when cost equals maxCostUsd", () => {
		const result = checkBudget(50_000, 0.15, { maxCostUsd: 0.15 });
		expect(result.exceeded).toBe(true);
		expect(result.reason).toMatch(/Cost budget/);
	});

	it("returns exceeded when cost exceeds maxCostUsd", () => {
		const result = checkBudget(50_000, 0.2, { maxCostUsd: 0.15 });
		expect(result.exceeded).toBe(true);
	});

	it("checks token limit before cost limit when both exceeded", () => {
		const result = checkBudget(200_000, 2.0, {
			maxTotalTokens: 150_000,
			maxCostUsd: 0.5,
		});
		expect(result.exceeded).toBe(true);
		expect(result.reason).toMatch(/Token budget/);
	});

	it("checks cost limit when only cost is exceeded", () => {
		const result = checkBudget(50_000, 2.0, {
			maxTotalTokens: 150_000,
			maxCostUsd: 0.5,
		});
		expect(result.exceeded).toBe(true);
		expect(result.reason).toMatch(/Cost budget/);
	});

	it("includes budget values in exceeded reason for tokens", () => {
		const result = checkBudget(160_000, 0.5, { maxTotalTokens: 150_000 });
		expect(result.reason).toContain("160,000");
		expect(result.reason).toContain("150,000");
	});
});

describe("computeCostUsd", () => {
	it("returns 0 for zero tokens", () => {
		const cost = computeCostUsd(
			{ inputTokens: 0, outputTokens: 0 },
			"claude-sonnet-4-20250514",
		);
		expect(cost).toBe(0);
	});

	it("computes cost for claude-sonnet-4-20250514 ($3/M in, $15/M out)", () => {
		const cost = computeCostUsd(
			{ inputTokens: 1_000_000, outputTokens: 1_000_000 },
			"claude-sonnet-4-20250514",
		);
		expect(cost).toBeCloseTo(18.0, 4);
	});

	it("computes cost for input tokens only", () => {
		const cost = computeCostUsd(
			{ inputTokens: 10_000, outputTokens: 0 },
			"claude-sonnet-4-20250514",
		);
		expect(cost).toBeCloseTo(0.03, 6);
	});

	it("computes cost for output tokens only", () => {
		const cost = computeCostUsd(
			{ inputTokens: 0, outputTokens: 10_000 },
			"claude-sonnet-4-20250514",
		);
		expect(cost).toBeCloseTo(0.15, 6);
	});

	it("falls back to default pricing for unknown model names", () => {
		const cost = computeCostUsd(
			{ inputTokens: 1_000_000, outputTokens: 0 },
			"unknown-model-xyz",
		);
		expect(cost).toBeCloseTo(3.0, 4);
	});
});
