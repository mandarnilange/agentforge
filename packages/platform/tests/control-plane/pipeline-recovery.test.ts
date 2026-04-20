import assert from "node:assert";
import { existsSync, rmSync } from "node:fs";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import { DEFAULT_RECOVERY_OPTIONS } from "agentforge-core/domain/models/recovery.model.js";
import type { PipelineEvent } from "agentforge-core/domain/ports/event-bus.port.js";
import type { IStateStore } from "agentforge-core/domain/ports/state-store.port.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineRecoveryService } from "../../src/control-plane/pipeline-recovery.js";

const TEST_DB = "/tmp/sdlc-recovery-test.db";

describe("PipelineRecoveryService (P17-T2)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;
	let recovery: PipelineRecoveryService;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		eventBus = new InMemoryEventBus();
		recovery = new PipelineRecoveryService(store, eventBus, {
			...DEFAULT_RECOVERY_OPTIONS,
			stuckRunThresholdMs: 60_000,
		});
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	// --- rehydrateActivePipelines ---

	describe("rehydrateActivePipelines", () => {
		it("finds pipelines in 'running' status", async () => {
			await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 2,
				startedAt: new Date().toISOString(),
			});

			const result = await recovery.rehydrateActivePipelines();

			expect(result.rehydratedPipelines).toHaveLength(1);
			expect(result.errors).toHaveLength(0);
		});

		it("finds pipelines in 'paused_at_gate' status", async () => {
			await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "paused_at_gate",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			const result = await recovery.rehydrateActivePipelines();

			expect(result.rehydratedPipelines).toHaveLength(1);
		});

		it("ignores completed/failed/cancelled pipelines", async () => {
			for (const status of ["completed", "failed", "cancelled"] as const) {
				await store.createPipelineRun({
					projectName: "proj",
					pipelineName: "std",
					status,
					currentPhase: 1,
					startedAt: new Date().toISOString(),
				});
			}

			const result = await recovery.rehydrateActivePipelines();

			expect(result.rehydratedPipelines).toHaveLength(0);
		});

		it("returns multiple active pipelines", async () => {
			await store.createPipelineRun({
				projectName: "proj-a",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			await store.createPipelineRun({
				projectName: "proj-b",
				pipelineName: "std",
				status: "running",
				currentPhase: 3,
				startedAt: new Date().toISOString(),
			});

			const result = await recovery.rehydrateActivePipelines();

			expect(result.rehydratedPipelines).toHaveLength(2);
		});
	});

	// --- detectAndFailStuckRuns ---

	describe("detectAndFailStuckRuns", () => {
		it("marks a stuck run as failed", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const stuckRun = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date(Date.now() - 120_000).toISOString(),
			});
			await store.updateAgentRun(stuckRun.id, {
				lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
			});

			const result = await recovery.detectAndFailStuckRuns(pipeline.id);

			expect(result.failedRuns).toHaveLength(1);
			// No retry runs created
			expect(result.retriedRuns).toHaveLength(0);

			const original = await store.getAgentRun(stuckRun.id);
			assert(original, "expected agent run to exist");
			expect(original.status).toBe("failed");
			expect(original.error).toContain("Stuck run");

			// Only the original run exists — no retry created
			const allRuns = await store.listAgentRuns(pipeline.id);
			expect(allRuns).toHaveLength(1);

			// Pipeline should also be marked failed
			const p = await store.getPipelineRun(pipeline.id);
			assert(p, "expected pipeline run to exist");
			expect(p.status).toBe("failed");
		});

		it("marks stuck run as failed regardless of retry count", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const stuckRun = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				retryCount: 2,
				startedAt: new Date(Date.now() - 120_000).toISOString(),
			});
			await store.updateAgentRun(stuckRun.id, {
				lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
			});

			const result = await recovery.detectAndFailStuckRuns(pipeline.id);

			expect(result.failedRuns).toHaveLength(1);
			const original = await store.getAgentRun(stuckRun.id);
			assert(original, "expected agent run to exist");
			expect(original.status).toBe("failed");
		});

		it("does not fail recently started runs", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
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
				startedAt: new Date().toISOString(),
			});

			const result = await recovery.detectAndFailStuckRuns(pipeline.id);

			expect(result.failedRuns).toHaveLength(0);
		});

		it("is idempotent — second call on already-failed run does nothing", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const stuckRun = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date(Date.now() - 120_000).toISOString(),
			});
			await store.updateAgentRun(stuckRun.id, {
				lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
			});

			const result1 = await recovery.detectAndFailStuckRuns(pipeline.id);
			expect(result1.failedRuns).toHaveLength(1);

			// Second call — run is already failed, pipeline is already failed
			const result2 = await recovery.detectAndFailStuckRuns(pipeline.id);
			expect(result2.failedRuns).toHaveLength(0);
		});

		it("emits events for failed runs and pipeline", async () => {
			const events: PipelineEvent[] = [];
			eventBus.subscribe((e) => events.push(e));

			const pipeline = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const stuckRun = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date(Date.now() - 120_000).toISOString(),
			});
			await store.updateAgentRun(stuckRun.id, {
				lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
			});

			await recovery.detectAndFailStuckRuns(pipeline.id);

			const runEvents = events.filter((e) => e.type === "run_updated");
			expect(runEvents).toHaveLength(1);
			const pipelineEvents = events.filter(
				(e) => e.type === "pipeline_updated",
			);
			expect(pipelineEvents).toHaveLength(1);
		});

		it("writes audit log for failed stuck runs", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const stuckRun = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date(Date.now() - 120_000).toISOString(),
			});
			await store.updateAgentRun(stuckRun.id, {
				lastStatusAt: new Date(Date.now() - 120_000).toISOString(),
			});

			await recovery.detectAndFailStuckRuns(pipeline.id);

			const logs = await store.listAuditLog(pipeline.id);
			expect(logs.length).toBeGreaterThanOrEqual(1);
			expect(logs[0].action).toBe("fail_stuck_run");
		});
	});

	// --- getRetryCount ---

	describe("getRetryCount", () => {
		it("returns 0 when no runs exist for agent", async () => {
			const count = await recovery.getRetryCount("nonexistent", "analyst", 1);
			expect(count).toBe(0);
		});

		it("returns the max retry count for an agent in a pipeline phase", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
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
				status: "failed",
				inputArtifactIds: [],
				outputArtifactIds: [],
				retryCount: 0,
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
				retryCount: 1,
				startedAt: new Date().toISOString(),
			});

			const count = await recovery.getRetryCount(pipeline.id, "analyst", 1);
			expect(count).toBe(1);
		});
	});

	// --- zombie pipeline detection ---

	describe("rehydrateActivePipelines — zombie detection", () => {
		it("marks pipeline as failed when running but has failed agent runs (zombie)", async () => {
			const events: PipelineEvent[] = [];
			eventBus.subscribe((e) => events.push(e));

			const pipeline = await store.createPipelineRun({
				projectName: "zombie-proj",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			// Create a failed agent run — makes this a zombie pipeline
			await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "failed",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
			});

			const result = await recovery.rehydrateActivePipelines();

			expect(result.rehydratedPipelines).toContain(pipeline.id);
			// Pipeline should be marked as failed
			const updated = await store.getPipelineRun(pipeline.id);
			expect(updated?.status).toBe("failed");
			// Should emit pipeline_updated event
			const pipelineEvents = events.filter(
				(e) => e.type === "pipeline_updated",
			);
			expect(pipelineEvents).toHaveLength(1);
		});

		it("does not mark paused_at_gate pipeline with failed runs as zombie", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "paused-proj",
				pipelineName: "std",
				status: "paused_at_gate",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "failed",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});

			const result = await recovery.rehydrateActivePipelines();
			expect(result.rehydratedPipelines).toContain(pipeline.id);
			// paused_at_gate pipelines should not be modified by zombie detection
			const updated = await store.getPipelineRun(pipeline.id);
			expect(updated?.status).toBe("paused_at_gate");
		});

		it("writes audit log for zombie pipeline detection", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "audit-zombie",
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
				status: "failed",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});

			await recovery.rehydrateActivePipelines();

			const logs = await store.listAuditLog(pipeline.id);
			expect(logs.some((l) => l.action === "fail_zombie_pipeline")).toBe(true);
		});
	});

	// --- error catch paths ---

	describe("error handling", () => {
		it("rehydrateActivePipelines captures errors in result.errors when store throws", async () => {
			const brokenStore = {
				listPipelineRuns: vi
					.fn()
					.mockRejectedValue(new Error("DB connection lost")),
			} as unknown as IStateStore;

			const brokenRecovery = new PipelineRecoveryService(
				brokenStore,
				eventBus,
				{
					...DEFAULT_RECOVERY_OPTIONS,
				},
			);
			const result = await brokenRecovery.rehydrateActivePipelines();
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("DB connection lost");
		});

		it("detectAndFailStuckRuns captures errors in result.errors when store throws", async () => {
			const brokenStore = {
				listAgentRuns: vi.fn().mockRejectedValue(new Error("Disk full")),
			} as unknown as IStateStore;

			const brokenRecovery = new PipelineRecoveryService(
				brokenStore,
				eventBus,
				{
					...DEFAULT_RECOVERY_OPTIONS,
				},
			);
			const result = await brokenRecovery.detectAndFailStuckRuns("pipe-1");
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain("Disk full");
		});

		it("getRetryCount returns 0 when store throws", async () => {
			const brokenStore = {
				listAgentRuns: vi.fn().mockRejectedValue(new Error("Network timeout")),
			} as unknown as IStateStore;

			const brokenRecovery = new PipelineRecoveryService(
				brokenStore,
				eventBus,
				{
					...DEFAULT_RECOVERY_OPTIONS,
				},
			);
			const count = await brokenRecovery.getRetryCount("pipe-1", "analyst", 1);
			expect(count).toBe(0);
		});
	});
});
