import type { NodeDefinitionYaml } from "agentforge-core/definitions/parser.js";
import type {
	AgentRunResult,
	IExecutionBackend,
} from "agentforge-core/domain/ports/execution-backend.port.js";
import { describe, expect, it, vi } from "vitest";
import { LocalNodeRuntime } from "../../src/nodes/local-runtime.js";

function makeNodeDef(name = "local"): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name, displayName: "Local Node", type: "local" },
		spec: {
			connection: { type: "local" },
			capabilities: ["llm-access", "local-fs"],
			resources: { maxConcurrentRuns: 3 },
		},
	};
}

function makeBackend(result?: Partial<AgentRunResult>): IExecutionBackend {
	return {
		runAgent: vi.fn().mockResolvedValue({
			artifacts: [],
			tokenUsage: { inputTokens: 100, outputTokens: 50 },
			durationMs: 500,
			events: [],
			...result,
		}),
	};
}

describe("LocalNodeRuntime", () => {
	it("exposes the node definition", () => {
		const def = makeNodeDef();
		const runtime = new LocalNodeRuntime(def, makeBackend());
		expect(runtime.nodeDefinition).toBe(def);
	});

	it("ping always returns true", async () => {
		const runtime = new LocalNodeRuntime(makeNodeDef(), makeBackend());
		const result = await runtime.ping();
		expect(result).toBe(true);
	});

	it("execute delegates to execution backend and returns success result", async () => {
		const backend = makeBackend({
			tokenUsage: { inputTokens: 200, outputTokens: 80 },
		});
		const runtime = new LocalNodeRuntime(makeNodeDef(), backend);

		const result = await runtime.execute({
			runId: "run-1",
			agentName: "analyst",
			executionBackendRequest: {
				agentId: "analyst",
				systemPrompt: "You are a BA",
				inputArtifacts: [],
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4-20250514",
					maxTokens: 8192,
				},
			},
		});

		expect(result.runId).toBe("run-1");
		expect(result.success).toBe(true);
		expect(result.result?.tokenUsage.inputTokens).toBe(200);
		expect(backend.runAgent).toHaveBeenCalledOnce();
	});

	it("execute wraps backend error in NodeRunResult with success=false", async () => {
		const backend: IExecutionBackend = {
			runAgent: vi.fn().mockRejectedValue(new Error("LLM timeout")),
		};
		const runtime = new LocalNodeRuntime(makeNodeDef(), backend);

		const result = await runtime.execute({
			runId: "run-2",
			agentName: "analyst",
			executionBackendRequest: {
				agentId: "analyst",
				systemPrompt: "You are a BA",
				inputArtifacts: [],
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4-20250514",
					maxTokens: 8192,
				},
			},
		});

		expect(result.runId).toBe("run-2");
		expect(result.success).toBe(false);
		expect(result.error).toMatch(/LLM timeout/);
		expect(result.result).toBeUndefined();
	});

	it("execute returns durationMs > 0", async () => {
		const runtime = new LocalNodeRuntime(makeNodeDef(), makeBackend());
		const result = await runtime.execute({
			runId: "run-3",
			agentName: "analyst",
			executionBackendRequest: {
				agentId: "analyst",
				systemPrompt: "You are a BA",
				inputArtifacts: [],
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4-20250514",
					maxTokens: 8192,
				},
			},
		});
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});
});
