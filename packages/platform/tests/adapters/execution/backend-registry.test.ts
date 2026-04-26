import type { IExecutionBackend } from "@mandarnilange/agentforge-core/domain/ports/execution-backend.port.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BackendFactory,
	BackendRegistry,
} from "../../../src/adapters/execution/backend-registry.js";

function makeMockBackend(): IExecutionBackend {
	return { runAgent: vi.fn() };
}

describe("BackendRegistry", () => {
	let registry: BackendRegistry;

	beforeEach(() => {
		registry = new BackendRegistry();
	});

	it("should resolve a registered backend factory by executor type", () => {
		const factory: BackendFactory = () => makeMockBackend();
		registry.register("openai", factory);

		const resolved = registry.resolve("openai");
		expect(resolved).toBeDefined();
		expect(resolved?.runAgent).toBeDefined();
	});

	it("should return undefined for unknown executor type", () => {
		const resolved = registry.resolve("unknown-provider");
		expect(resolved).toBeUndefined();
	});

	it("should register and resolve multiple factories independently", () => {
		const openaiBackend = makeMockBackend();
		const geminiBackend = makeMockBackend();

		registry.register("openai", () => openaiBackend);
		registry.register("gemini", () => geminiBackend);

		expect(registry.resolve("openai")).toBe(openaiBackend);
		expect(registry.resolve("gemini")).toBe(geminiBackend);
	});

	it("should pass options to factory when resolving", () => {
		const factory = vi.fn().mockReturnValue(makeMockBackend());
		registry.register("openai", factory);

		const options = { onProgress: vi.fn(), workdir: "/tmp" };
		registry.resolve("openai", options);

		expect(factory).toHaveBeenCalledWith(options);
	});

	it("should support -coding suffix variants", () => {
		const docBackend = makeMockBackend();
		const codeBackend = makeMockBackend();

		registry.register("openai", () => docBackend);
		registry.register("openai-coding", () => codeBackend);

		expect(registry.resolve("openai")).toBe(docBackend);
		expect(registry.resolve("openai-coding")).toBe(codeBackend);
	});

	it("should list all registered executor types", () => {
		registry.register("openai", () => makeMockBackend());
		registry.register("gemini", () => makeMockBackend());
		registry.register("ollama", () => makeMockBackend());

		const types = registry.listTypes();
		expect(types).toEqual(
			expect.arrayContaining(["openai", "gemini", "ollama"]),
		);
		expect(types).toHaveLength(3);
	});

	it("should override a previously registered factory", () => {
		const first = makeMockBackend();
		const second = makeMockBackend();

		registry.register("openai", () => first);
		registry.register("openai", () => second);

		expect(registry.resolve("openai")).toBe(second);
	});
});
