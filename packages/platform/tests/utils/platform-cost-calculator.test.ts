import { describe, expect, it } from "vitest";
import { platformEstimateCostUsd } from "../../src/utils/platform-cost-calculator.js";

describe("platformEstimateCostUsd", () => {
	describe("OpenAI models", () => {
		it("should price gpt-4o", () => {
			const cost = platformEstimateCostUsd("gpt-4o", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// gpt-4o: $2.50/1M input, $10.00/1M output
			expect(cost).toBeCloseTo(12.5, 2);
		});

		it("should price gpt-4o-mini", () => {
			const cost = platformEstimateCostUsd("gpt-4o-mini", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// gpt-4o-mini: $0.15/1M input, $0.60/1M output
			expect(cost).toBeCloseTo(0.75, 2);
		});

		it("should price o1", () => {
			const cost = platformEstimateCostUsd("o1", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// o1: $15.00/1M input, $60.00/1M output
			expect(cost).toBeCloseTo(75.0, 2);
		});

		it("should price o1-mini", () => {
			const cost = platformEstimateCostUsd("o1-mini", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// o1-mini: $1.10/1M input, $4.40/1M output
			expect(cost).toBeCloseTo(5.5, 2);
		});
	});

	describe("Gemini models", () => {
		it("should price gemini-2.5-pro", () => {
			const cost = platformEstimateCostUsd("gemini-2.5-pro", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// gemini-2.5-pro: $1.25/1M input, $10.00/1M output
			expect(cost).toBeCloseTo(11.25, 2);
		});

		it("should price gemini-2.5-flash", () => {
			const cost = platformEstimateCostUsd("gemini-2.5-flash", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// gemini-2.5-flash: $0.15/1M input, $0.60/1M output
			expect(cost).toBeCloseTo(0.75, 2);
		});
	});

	describe("Ollama models", () => {
		it("should return 0 for local Ollama models", () => {
			const cost = platformEstimateCostUsd("llama3", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			expect(cost).toBe(0);
		});

		it("should return 0 for any unknown local model", () => {
			const cost = platformEstimateCostUsd("mistral-7b", {
				inputTokens: 500_000,
				outputTokens: 500_000,
			});
			expect(cost).toBe(0);
		});
	});

	describe("Claude models (fallback to core)", () => {
		it("should price claude-sonnet-4 via core calculator", () => {
			const cost = platformEstimateCostUsd("claude-sonnet-4-20250514", {
				inputTokens: 1_000_000,
				outputTokens: 1_000_000,
			});
			// claude-sonnet-4: $3.00/1M input, $15.00/1M output
			expect(cost).toBeCloseTo(18.0, 2);
		});
	});

	describe("token extras", () => {
		it("should price OpenAI reasoning token extras", () => {
			const cost = platformEstimateCostUsd("o1", {
				inputTokens: 1_000_000,
				outputTokens: 0,
				extras: [
					{ kind: "openai.reasoning", tokens: 1_000_000, costMultiplier: 1.0 },
				],
			});
			// $15.00 input + $15.00 reasoning (1.0x input price)
			expect(cost).toBeCloseTo(30.0, 2);
		});
	});
});
