import { existsSync, rmSync } from "node:fs";
import type { PipelineLimits } from "agentforge-core/domain/models/rate-limits.model.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineRateLimiter } from "../../src/control-plane/rate-limiter.js";

const TEST_DB = "/tmp/sdlc-rate-limiter-test.db";

describe("PipelineRateLimiter (P17-T3)", () => {
	let store: SqliteStateStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	async function createPipelineWithRuns(
		projectName: string,
		tokenUsages: Array<{ inputTokens: number; outputTokens: number }>,
		costs: number[],
	) {
		const pipeline = await store.createPipelineRun({
			projectName,
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});

		for (let i = 0; i < tokenUsages.length; i++) {
			await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: `agent-${i}`,
				phase: 1,
				nodeName: "local",
				status: "succeeded",
				inputArtifactIds: [],
				outputArtifactIds: [],
				tokenUsage: tokenUsages[i],
				costUsd: costs[i],
				startedAt: new Date().toISOString(),
			});
		}

		return pipeline;
	}

	// --- No limits configured ---

	it("returns no violations when no limits are set", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[{ inputTokens: 100_000, outputTokens: 50_000 }],
			[10.0],
		);

		const limiter = new PipelineRateLimiter(store, {});
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(0);
	});

	// --- Token limits ---

	it("returns no violation when tokens are under limit", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[{ inputTokens: 500, outputTokens: 300 }],
			[0.01],
		);

		const limits: PipelineLimits = { maxTokensPerPipeline: 10_000 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(0);
	});

	it("returns violation when total tokens exceed limit", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[
				{ inputTokens: 5_000, outputTokens: 3_000 },
				{ inputTokens: 4_000, outputTokens: 2_000 },
			],
			[1.0, 1.0],
		);

		const limits: PipelineLimits = { maxTokensPerPipeline: 10_000 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(1);
		expect(violations[0].type).toBe("tokens");
		expect(violations[0].actual).toBe(14_000);
		expect(violations[0].limit).toBe(10_000);
	});

	// --- Cost limits ---

	it("returns no violation when cost is under limit", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[{ inputTokens: 100, outputTokens: 50 }],
			[5.0],
		);

		const limits: PipelineLimits = { maxCostPerPipeline: 50.0 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(0);
	});

	it("returns violation when total cost exceeds limit", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[
				{ inputTokens: 100, outputTokens: 50 },
				{ inputTokens: 100, outputTokens: 50 },
			],
			[30.0, 25.0],
		);

		const limits: PipelineLimits = { maxCostPerPipeline: 50.0 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(1);
		expect(violations[0].type).toBe("cost");
		expect(violations[0].actual).toBe(55.0);
		expect(violations[0].limit).toBe(50.0);
	});

	// --- Concurrent runs limit ---

	it("returns no violation when concurrent runs are under limit", async () => {
		const pipeline = await store.createPipelineRun({
			projectName: "proj",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});

		const limits: PipelineLimits = { maxConcurrentRunsPerProject: 5 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(0);
	});

	it("returns violation when concurrent runs exceed limit", async () => {
		// Create 3 running pipelines for same project
		for (let i = 0; i < 3; i++) {
			await store.createPipelineRun({
				projectName: "proj",
				pipelineName: `std-${i}`,
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
		}

		// Use the first pipeline's id for the check
		const all = await store.listPipelineRuns();
		const first = all[all.length - 1];

		const limits: PipelineLimits = { maxConcurrentRunsPerProject: 2 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(first.id);

		expect(violations).toHaveLength(1);
		expect(violations[0].type).toBe("concurrent_runs");
		expect(violations[0].actual).toBe(3);
		expect(violations[0].limit).toBe(2);
	});

	it("does not count completed/failed pipelines toward concurrent limit", async () => {
		await store.createPipelineRun({
			projectName: "proj",
			pipelineName: "std-done",
			status: "completed",
			currentPhase: 3,
			startedAt: new Date().toISOString(),
		});
		await store.createPipelineRun({
			projectName: "proj",
			pipelineName: "std-failed",
			status: "failed",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const active = await store.createPipelineRun({
			projectName: "proj",
			pipelineName: "std-active",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});

		const limits: PipelineLimits = { maxConcurrentRunsPerProject: 2 };
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(active.id);

		expect(violations).toHaveLength(0);
	});

	// --- Multiple violations ---

	it("returns multiple violations when both token and cost limits exceeded", async () => {
		const pipeline = await createPipelineWithRuns(
			"proj",
			[{ inputTokens: 10_000, outputTokens: 5_000 }],
			[100.0],
		);

		const limits: PipelineLimits = {
			maxTokensPerPipeline: 1_000,
			maxCostPerPipeline: 10.0,
		};
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(2);
		const types = violations.map((v) => v.type);
		expect(types).toContain("tokens");
		expect(types).toContain("cost");
	});

	// --- Runs without token/cost data ---

	it("handles runs with no token usage or cost gracefully", async () => {
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
			status: "succeeded",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const limits: PipelineLimits = {
			maxTokensPerPipeline: 1_000,
			maxCostPerPipeline: 10.0,
		};
		const limiter = new PipelineRateLimiter(store, limits);
		const violations = await limiter.checkLimits(pipeline.id);

		expect(violations).toHaveLength(0);
	});
});
