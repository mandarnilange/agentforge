import { describe, expect, it } from "vitest";
import {
	parseModelFlag,
	resolveModel,
} from "../../src/utils/model-resolver.js";

describe("parseModelFlag", () => {
	it("returns a bare name when there is no slash", () => {
		expect(parseModelFlag("claude-sonnet-4-6")).toEqual({
			name: "claude-sonnet-4-6",
		});
	});

	it("splits provider/name on the first slash", () => {
		expect(parseModelFlag("openai/gpt-4o")).toEqual({
			provider: "openai",
			name: "gpt-4o",
		});
	});

	it("keeps later slashes in the name", () => {
		expect(parseModelFlag("openrouter/anthropic/claude")).toEqual({
			provider: "openrouter",
			name: "anthropic/claude",
		});
	});

	it("treats a malformed value with an empty side as a bare name", () => {
		expect(parseModelFlag("/x")).toEqual({ name: "/x" });
		expect(parseModelFlag("x/")).toEqual({ name: "x/" });
	});
});

describe("resolveModel", () => {
	const base = {
		defaultProvider: "anthropic",
		defaultName: "claude-sonnet-4-6",
		defaultMaxTokens: 64000,
	};

	it("uses spec.model over the config default", () => {
		expect(
			resolveModel({
				...base,
				specModel: {
					provider: "anthropic",
					name: "claude-opus-4-6",
					maxTokens: 16384,
					thinking: "high",
				},
			}),
		).toEqual({
			provider: "anthropic",
			name: "claude-opus-4-6",
			maxTokens: 16384,
			thinking: "high",
		});
	});

	it("falls back to config when spec.model is absent", () => {
		expect(resolveModel({ ...base })).toEqual({
			provider: "anthropic",
			name: "claude-sonnet-4-6",
			maxTokens: 64000,
			thinking: undefined,
		});
	});

	it("falls back per field when spec.model omits maxTokens", () => {
		const r = resolveModel({
			...base,
			specModel: { provider: "anthropic", name: "claude-opus-4-6" },
		});
		expect(r.name).toBe("claude-opus-4-6");
		expect(r.maxTokens).toBe(64000);
	});

	it("lets modelOverride (--model name) win over spec.model name", () => {
		const r = resolveModel({
			...base,
			modelOverride: "claude-haiku-4-5",
			specModel: { provider: "anthropic", name: "claude-opus-4-6" },
		});
		expect(r.name).toBe("claude-haiku-4-5");
	});

	it("uses the default provider for a bare --model, ignoring spec provider", () => {
		const r = resolveModel({
			...base,
			modelOverride: "claude-haiku-4-5",
			specModel: { provider: "openai", name: "gpt-4o" },
		});
		// bare --model => default provider, not the spec's "openai"
		expect(r.provider).toBe("anthropic");
		expect(r.name).toBe("claude-haiku-4-5");
	});

	it("lets providerOverride (--model provider/name) win over spec provider", () => {
		const r = resolveModel({
			...base,
			modelOverride: "gpt-4o",
			providerOverride: "openai",
			specModel: { provider: "anthropic", name: "claude-opus-4-6" },
		});
		expect(r.provider).toBe("openai");
		expect(r.name).toBe("gpt-4o");
	});

	it("keeps spec.model provider when there is no --model override", () => {
		const r = resolveModel({
			...base,
			specModel: { provider: "openai", name: "gpt-4o" },
		});
		expect(r.provider).toBe("openai");
		expect(r.name).toBe("gpt-4o");
	});
});
