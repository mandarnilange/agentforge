import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "mock-model",
		name: "mock-model",
		api: "openai-responses",
		provider: "openai",
	}),
	stream: vi.fn(),
}));

import { createPlatformBackendForExecutor } from "../../src/di/platform-container.js";

describe("createPlatformBackendForExecutor", () => {
	const savedEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		process.env = { ...savedEnv };
	});

	it("should return a backend for pi-ai executor type", () => {
		const backend = createPlatformBackendForExecutor("pi-ai");
		expect(backend).toBeDefined();
		expect(backend.runAgent).toBeDefined();
	});

	it("should return a backend for pi-coding-agent executor type", () => {
		const backend = createPlatformBackendForExecutor("pi-coding-agent");
		expect(backend).toBeDefined();
		expect(backend.runAgent).toBeDefined();
	});

	it("should wrap backend with provider-aware middleware", async () => {
		const backend = createPlatformBackendForExecutor("pi-ai");

		// Calling with openai provider without API key should throw
		delete process.env.OPENAI_API_KEY;
		await expect(
			backend.runAgent({
				agentId: "test",
				systemPrompt: "test",
				inputArtifacts: [],
				model: { provider: "openai", name: "gpt-4o", maxTokens: 8192 },
			}),
		).rejects.toThrow("OPENAI_API_KEY");
	});

	it("should pass options through to core backend", () => {
		const onProgress = vi.fn();
		const backend = createPlatformBackendForExecutor("pi-ai", {
			onProgress,
		});
		expect(backend).toBeDefined();
	});
});
