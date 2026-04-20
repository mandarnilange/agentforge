import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-occ-test.db";

describe("Optimistic Concurrency Control (P18-T14)", () => {
	let store: SqliteStateStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	describe("gates", () => {
		it("gate has version field starting at 1", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "test",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const gate = await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			});

			expect(gate.version).toBe(1);
		});

		it("gate version increments on update", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "test",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const gate = await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			});

			await store.updateGate(gate.id, {
				status: "approved",
				reviewer: "alice",
				decidedAt: new Date().toISOString(),
			});

			const updated = await store.getGate(gate.id);
			expect(updated?.version).toBe(2);
		});
	});

	describe("pipeline runs", () => {
		it("pipeline run has version field starting at 1", async () => {
			const run = await store.createPipelineRun({
				projectName: "test",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			expect(run.version).toBe(1);
		});

		it("pipeline run version increments on update", async () => {
			const run = await store.createPipelineRun({
				projectName: "test",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			await store.updatePipelineRun(run.id, { status: "paused_at_gate" });

			const updated = await store.getPipelineRun(run.id);
			expect(updated?.version).toBe(2);
		});
	});
});
