import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";
import { traceStateStore } from "../../src/observability/traced-state-store.js";

function makeMockStore(): IStateStore {
	return {
		createPipelineRun: vi.fn().mockResolvedValue({ id: "pipe-1" }),
		getPipelineRun: vi
			.fn()
			.mockResolvedValue({ id: "pipe-1", status: "running" }),
		updatePipelineRun: vi.fn().mockResolvedValue(undefined),
		listPipelineRuns: vi.fn().mockResolvedValue([]),
		createAgentRun: vi.fn().mockResolvedValue({ id: "run-1" }),
		getAgentRun: vi.fn().mockResolvedValue(null),
		updateAgentRun: vi.fn().mockResolvedValue(undefined),
		listAgentRuns: vi.fn().mockResolvedValue([]),
		createGate: vi.fn().mockResolvedValue({ id: "gate-1" }),
		getGate: vi.fn().mockResolvedValue(null),
		updateGate: vi.fn().mockResolvedValue(undefined),
		listGates: vi.fn().mockResolvedValue([]),
		getPendingGate: vi.fn().mockResolvedValue(null),
		upsertNode: vi.fn().mockResolvedValue(undefined),
		getNode: vi.fn().mockResolvedValue(null),
		listNodes: vi.fn().mockResolvedValue([]),
		writeAuditLog: vi.fn().mockResolvedValue(undefined),
		listAuditLog: vi.fn().mockResolvedValue([]),
		appendExecutionLog: vi.fn().mockResolvedValue(undefined),
		getExecutionLog: vi.fn().mockResolvedValue(null),
		appendConversationLog: vi.fn().mockResolvedValue(undefined),
		getConversationLog: vi.fn().mockResolvedValue([]),
		writePipelineInputs: vi.fn().mockResolvedValue(undefined),
		getPipelineInputs: vi.fn().mockResolvedValue(null),
		close: vi.fn(),
	} as unknown as IStateStore;
}

describe("traceStateStore", () => {
	it("returns a proxy that forwards method calls to underlying store", async () => {
		const inner = makeMockStore();
		const traced = traceStateStore(inner);

		const result = await traced.listPipelineRuns();
		expect(result).toEqual([]);
		expect(inner.listPipelineRuns).toHaveBeenCalled();
	});

	it("forwards createPipelineRun with arguments", async () => {
		const inner = makeMockStore();
		const traced = traceStateStore(inner);

		const input = {
			projectName: "my-proj",
			pipelineName: "standard-sdlc",
			status: "running" as const,
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		};
		await traced.createPipelineRun(input);
		expect(inner.createPipelineRun).toHaveBeenCalledWith(input);
	});

	it("forwards string ID argument as span attribute", async () => {
		const inner = makeMockStore();
		const traced = traceStateStore(inner);

		await traced.getPipelineRun("pipe-123");
		expect(inner.getPipelineRun).toHaveBeenCalledWith("pipe-123");
	});

	it("propagates resolved values from async methods", async () => {
		const inner = makeMockStore();
		(inner.createPipelineRun as ReturnType<typeof vi.fn>).mockResolvedValue({
			id: "new-pipe",
			status: "running",
		});
		const traced = traceStateStore(inner);

		const result = await traced.createPipelineRun({
			projectName: "p",
			pipelineName: "q",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		expect(result).toMatchObject({ id: "new-pipe" });
	});

	it("propagates errors from async methods", async () => {
		const inner = makeMockStore();
		const boom = new Error("DB down");
		(inner.listPipelineRuns as ReturnType<typeof vi.fn>).mockRejectedValue(
			boom,
		);
		const traced = traceStateStore(inner);

		await expect(traced.listPipelineRuns()).rejects.toThrow("DB down");
	});

	it("forwards synchronous non-function properties unchanged", () => {
		const inner = makeMockStore() as Record<string, unknown>;
		inner.someStringProp = "hello";
		const traced = traceStateStore(inner as IStateStore) as Record<
			string,
			unknown
		>;
		expect(traced.someStringProp).toBe("hello");
	});

	it("handles method that throws synchronously", async () => {
		const inner = makeMockStore();
		(inner.listPipelineRuns as ReturnType<typeof vi.fn>).mockImplementation(
			() => {
				throw new Error("sync error");
			},
		);
		const traced = traceStateStore(inner);

		expect(() => traced.listPipelineRuns()).toThrow("sync error");
	});

	it("handles listAgentRuns for pipeline", async () => {
		const inner = makeMockStore();
		(inner.listAgentRuns as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ id: "run-1", agentName: "analyst" },
		]);
		const traced = traceStateStore(inner);

		const runs = await traced.listAgentRuns("pipe-1");
		expect(runs).toHaveLength(1);
		expect(inner.listAgentRuns).toHaveBeenCalledWith("pipe-1");
	});

	it("acquires tracer lazily on each call so late-registered providers are honored", async () => {
		// Regression for P7-T6: previously the tracer was captured at module load
		// time via `const tracer = trace.getTracer(...)`. If NodeSDK registered its
		// provider AFTER the module was imported, the captured tracer stayed a
		// no-op forever and no spans reached Jaeger. Acquiring the tracer per-call
		// guarantees the currently registered provider is used.
		const spy = vi.spyOn(trace, "getTracer");
		const inner = makeMockStore();
		const traced = traceStateStore(inner);

		spy.mockClear();
		await traced.getPipelineRun("pipe-late");
		await traced.listPipelineRuns();

		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
		spy.mockRestore();
	});

	it("wraps all IStateStore methods as traced proxies", () => {
		const inner = makeMockStore();
		const traced = traceStateStore(inner);

		// All method names should be accessible
		const methods = [
			"createPipelineRun",
			"getPipelineRun",
			"listPipelineRuns",
			"createAgentRun",
			"getAgentRun",
			"listAgentRuns",
			"createGate",
			"getGate",
			"listGates",
		];
		for (const method of methods) {
			expect(typeof (traced as Record<string, unknown>)[method]).toBe(
				"function",
			);
		}
	});
});
