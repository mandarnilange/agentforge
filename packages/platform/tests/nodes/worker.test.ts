import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { IControlPlaneApi } from "@mandarnilange/agentforge-core/domain/ports/control-plane-api.port.js";
import type {
	INodeRuntime,
	NodeRunResult,
} from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";
import { describe, expect, it, vi } from "vitest";
import { NodeWorker } from "../../src/nodes/worker.js";

function makeNodeDef(name = "local"): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name, type: "local" },
		spec: { connection: { type: "local" }, capabilities: ["llm-access"] },
	};
}

function makeRuntime(name = "local"): INodeRuntime {
	const result: NodeRunResult = {
		runId: "run-1",
		success: true,
		durationMs: 100,
		result: {
			artifacts: [],
			tokenUsage: { inputTokens: 10, outputTokens: 5 },
			durationMs: 100,
			events: [],
		},
	};
	return {
		nodeDefinition: makeNodeDef(name),
		ping: vi.fn().mockResolvedValue(true),
		execute: vi.fn().mockResolvedValue(result),
	};
}

function makeApi(pendingRuns = []): IControlPlaneApi {
	return {
		registerNode: vi.fn(),
		reportHeartbeat: vi.fn(),
		reportRunResult: vi.fn(),
		getPendingRuns: vi.fn().mockReturnValue(pendingRuns),
	};
}

describe("NodeWorker", () => {
	it("registers node on start", async () => {
		const runtime = makeRuntime();
		const api = makeApi();
		const worker = new NodeWorker(runtime, api);

		await worker.start();

		expect(api.registerNode).toHaveBeenCalledWith(runtime.nodeDefinition);
	});

	it("polls pending runs and executes them", async () => {
		const runtime = makeRuntime();
		const pendingRun = {
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
		};
		const api = makeApi([pendingRun]);
		const worker = new NodeWorker(runtime, api);

		await worker.pollOnce();

		expect(runtime.execute).toHaveBeenCalledWith(pendingRun);
		expect(api.reportRunResult).toHaveBeenCalledWith(
			"run-1",
			expect.objectContaining({ runId: "run-1", success: true }),
		);
	});

	it("reports results back even on failure", async () => {
		const runtime = makeRuntime();
		(runtime.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
			runId: "run-err",
			success: false,
			error: "timeout",
			durationMs: 100,
		});
		const pendingRun = {
			runId: "run-err",
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
		};
		const api = makeApi([pendingRun]);
		const worker = new NodeWorker(runtime, api);

		await worker.pollOnce();

		expect(api.reportRunResult).toHaveBeenCalledWith(
			"run-err",
			expect.objectContaining({ success: false, error: "timeout" }),
		);
	});

	it("handles empty pending queue without error", async () => {
		const runtime = makeRuntime();
		const api = makeApi([]);
		const worker = new NodeWorker(runtime, api);

		await expect(worker.pollOnce()).resolves.not.toThrow();
		expect(runtime.execute).not.toHaveBeenCalled();
	});

	it("reports heartbeat with active run count", async () => {
		const runtime = makeRuntime();
		const api = makeApi();
		const worker = new NodeWorker(runtime, api);

		await worker.reportHeartbeat();

		expect(api.reportHeartbeat).toHaveBeenCalledWith(
			"local",
			expect.any(Number),
		);
	});
});
