import assert from "node:assert";
import { existsSync, rmSync } from "node:fs";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import { DEFAULT_RECOVERY_OPTIONS } from "agentforge-core/domain/models/recovery.model.js";
import type { PipelineEvent } from "agentforge-core/domain/ports/event-bus.port.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineRecoveryService } from "../../src/control-plane/pipeline-recovery.js";
import { ReconciliationLoop } from "../../src/control-plane/reconciler.js";

const TEST_DB = "/tmp/sdlc-reconciler-test.db";

describe("ReconciliationLoop (P18-T10)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		eventBus = new InMemoryEventBus();
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("detects agent runs stuck in 'running' with stale lastStatusAt", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		// Set lastStatusAt to 120 seconds ago (well past 60s threshold)
		const staleTime = new Date(Date.now() - 120_000).toISOString();
		await store.updateAgentRun(agentRun.id, { lastStatusAt: staleTime });

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});

		const result = await reconciler.reconcile();

		expect(result.staleRunsDetected).toBe(1);

		const updated = await store.getAgentRun(agentRun.id);
		expect(updated?.status).toBe("failed");
		expect(updated?.error).toContain("executor timeout");
	});

	it("does not flag runs with recent lastStatusAt", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		// Set lastStatusAt to 10 seconds ago (well within threshold)
		await store.updateAgentRun(agentRun.id, {
			lastStatusAt: new Date(Date.now() - 10_000).toISOString(),
		});

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		const result = await reconciler.reconcile();

		expect(result.staleRunsDetected).toBe(0);
		const updated = await store.getAgentRun(agentRun.id);
		expect(updated?.status).toBe("running");
	});

	it("does not flag running runs without lastStatusAt (just started)", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(), // just started, no status yet
		});

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		const result = await reconciler.reconcile();

		// A run that just started and has no lastStatusAt should use startedAt
		// as the baseline — it shouldn't be flagged if it just started
		expect(result.staleRunsDetected).toBe(0);
	});

	it("emits events for stale run detection", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		await store.updateAgentRun(agentRun.id, {
			lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
		});

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		await reconciler.reconcile();

		const runEvents = events.filter((e) => e.type === "run_updated");
		expect(runEvents.length).toBeGreaterThanOrEqual(1);
	});

	it("is idempotent — running twice with same state produces same result", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		await store.updateAgentRun(agentRun.id, {
			lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
		});

		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});

		const result1 = await reconciler.reconcile();
		expect(result1.staleRunsDetected).toBe(1);

		// Second run: the run is now "failed", so no stale runs
		const result2 = await reconciler.reconcile();
		expect(result2.staleRunsDetected).toBe(0);
	});

	it("fails stale runs via recovery service when provided (no auto-retry)", async () => {
		const recoveryService = new PipelineRecoveryService(store, eventBus, {
			...DEFAULT_RECOVERY_OPTIONS,
			stuckRunThresholdMs: 60_000,
		});

		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "analyst",
			phase: 1,
			nodeName: "local",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});
		await store.updateAgentRun(agentRun.id, {
			lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
		});

		const reconciler = new ReconciliationLoop(
			store,
			eventBus,
			{ staleRunTimeoutMs: 60_000 },
			recoveryService,
		);

		const result = await reconciler.reconcile();

		expect(result.staleRunsDetected).toBe(1);
		expect(result.failedRuns).toBe(1);
		// No retry runs created — user must manually retry
		expect(result.retriedRuns).toBe(0);

		const allRuns = await store.listAgentRuns(pipeline.id);
		expect(allRuns).toHaveLength(1);
		expect(allRuns[0].status).toBe("failed");

		// Pipeline should also be failed
		const p = await store.getPipelineRun(pipeline.id);
		assert(p, "expected pipeline run to exist");
		expect(p.status).toBe("failed");
	});

	it("start() and stop() control the interval without throwing", async () => {
		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		reconciler.start(10); // short interval so the callback fires
		await new Promise((resolve) => setTimeout(resolve, 40));
		reconciler.stop();
		reconciler.stop(); // idempotent
	});

	it("stop() is a no-op when not started", () => {
		const reconciler = new ReconciliationLoop(store, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		expect(() => reconciler.stop()).not.toThrow();
	});

	it("reconcile() captures errors in result.errors when store throws", async () => {
		const { vi } = await import("vitest");
		const brokenStore = {
			listPipelineRuns: vi
				.fn()
				.mockRejectedValue(new Error("DB connection lost")),
		} as unknown as typeof store;

		const reconciler = new ReconciliationLoop(brokenStore, eventBus, {
			staleRunTimeoutMs: 60_000,
		});
		const result = await reconciler.reconcile();
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain("DB connection lost");
	});
});
