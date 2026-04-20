/**
 * Integration test: real extension loading via pi-coding-agent loader.
 *
 * Bypasses the pi-coding-agent mock used in unit tests and exercises
 * discoverAndLoadExtensions against the actual .agentforge/extensions/example-skill.ts
 * scaffold. Proves the P36 runtime wiring works end-to-end without calling
 * the LLM (the Agent constructor is still mocked; only the extension loader is real).
 */

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAgentConstructor = vi.fn();
const mockPrompt = vi.fn().mockResolvedValue(undefined);
const mockSubscribe = vi.fn().mockReturnValue(() => {});
const mockState = {
	messages: [] as unknown[],
	systemPrompt: "",
	model: {},
	thinkingLevel: "medium",
	tools: [],
};

vi.mock("@mariozechner/pi-agent-core", () => {
	class MockAgent {
		prompt = mockPrompt;
		subscribe = mockSubscribe;
		abort = vi.fn();
		get state() {
			return mockState;
		}
		constructor(opts?: unknown) {
			mockAgentConstructor(opts);
		}
	}
	return { Agent: MockAgent };
});

vi.mock("@mariozechner/pi-ai", () => ({
	getModel: vi.fn().mockReturnValue({
		id: "claude-sonnet-4-20250514",
		name: "claude-sonnet-4-20250514",
		api: "anthropic-messages",
		provider: "anthropic",
	}),
}));

import { PiCodingAgentExecutionBackend } from "../../src/adapters/execution/pi-coding-agent-backend.js";

const REPO_ROOT = join(__dirname, "../../../..");
const AGENTFORGE_DIR = join(REPO_ROOT, ".agentforge");

describe("extension loading — real pi-coding-agent loader", () => {
	beforeEach(() => {
		mockAgentConstructor.mockClear();
	});

	it("loads example-skill.ts and registers example_hello on the Agent", async () => {
		const backend = new PiCodingAgentExecutionBackend({
			workdir: REPO_ROOT,
			agentforgeDir: AGENTFORGE_DIR,
		});

		const result = await backend.runAgent({
			agentId: "test-agent",
			systemPrompt: "test",
			inputArtifacts: [],
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4-20250514",
				maxTokens: 8192,
			},
			extensions: ["extensions/example-skill.ts"],
		});

		expect(result.events.find((e) => e.kind === "error")).toBeUndefined();
		expect(mockAgentConstructor).toHaveBeenCalledOnce();

		const opts = mockAgentConstructor.mock.calls[0][0] as {
			initialState: { tools: Array<{ name: string }> };
		};
		const toolNames = opts.initialState.tools.map((t) => t.name);
		expect(toolNames).toContain("example_hello");
	}, 20_000);

	it("surfaces a loader error when the extension path does not exist", async () => {
		const backend = new PiCodingAgentExecutionBackend({
			workdir: REPO_ROOT,
			agentforgeDir: AGENTFORGE_DIR,
		});

		const result = await backend.runAgent({
			agentId: "test-agent",
			systemPrompt: "test",
			inputArtifacts: [],
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4-20250514",
				maxTokens: 8192,
			},
			extensions: ["extensions/does-not-exist.ts"],
		});

		const errorEvent = result.events.find((e) => e.kind === "error");
		expect(errorEvent).toBeDefined();
		expect(mockAgentConstructor).not.toHaveBeenCalled();
	}, 20_000);
});
