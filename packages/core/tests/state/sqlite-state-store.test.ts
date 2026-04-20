import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-test.db";

describe("SqliteStateStore", () => {
	let store: SqliteStateStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	// --- Pipeline Runs ---

	describe("pipeline runs", () => {
		it("creates and retrieves a pipeline run", async () => {
			const run = await store.createPipelineRun({
				projectName: "my-project",
				pipelineName: "standard-sdlc",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			expect(run.id).toBeTruthy();
			expect(run.projectName).toBe("my-project");
			expect(run.status).toBe("running");
			expect(run.currentPhase).toBe(1);

			const fetched = await store.getPipelineRun(run.id);
			expect(fetched).toEqual(run);
		});

		it("lists all pipeline runs", async () => {
			await store.createPipelineRun({
				projectName: "p1",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			await store.createPipelineRun({
				projectName: "p2",
				pipelineName: "std",
				status: "completed",
				currentPhase: 6,
				startedAt: new Date().toISOString(),
			});

			const runs = await store.listPipelineRuns();
			expect(runs).toHaveLength(2);
		});

		it("updates a pipeline run status", async () => {
			const run = await store.createPipelineRun({
				projectName: "p1",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			await store.updatePipelineRun(run.id, {
				status: "paused_at_gate",
				currentPhase: 2,
			});

			const updated = await store.getPipelineRun(run.id);
			expect(updated?.status).toBe("paused_at_gate");
			expect(updated?.currentPhase).toBe(2);
		});

		it("returns null for unknown pipeline run", async () => {
			expect(await store.getPipelineRun("nonexistent")).toBeNull();
		});
	});

	// --- Agent Runs ---

	describe("agent runs", () => {
		it("creates and retrieves an agent run", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			const run = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "pending",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});

			expect(run.id).toBeTruthy();
			expect(run.agentName).toBe("analyst");
			expect(run.phase).toBe(1);

			const fetched = await store.getAgentRun(run.id);
			expect(fetched?.agentName).toBe("analyst");
		});

		it("stores and retrieves revisionNotes on an agent run", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			const run = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "pending",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
				revisionNotes: "Please add error handling",
			});

			expect(run.revisionNotes).toBe("Please add error handling");
			const fetched = await store.getAgentRun(run.id);
			expect(fetched?.revisionNotes).toBe("Please add error handling");
		});

		it("lists agent runs for a pipeline", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
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
				status: "pending",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});
			await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "architect",
				phase: 2,
				nodeName: "local",
				status: "pending",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});

			const runs = await store.listAgentRuns(pipeline.id);
			expect(runs).toHaveLength(2);
		});

		it("updates agent run status to succeeded", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			const run = await store.createAgentRun({
				pipelineRunId: pipeline.id,
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});

			await store.updateAgentRun(run.id, {
				status: "succeeded",
				completedAt: new Date().toISOString(),
			});

			const updated = await store.getAgentRun(run.id);
			expect(updated?.status).toBe("succeeded");
			expect(updated?.completedAt).toBeTruthy();
		});
	});

	// --- Gates ---

	describe("gates", () => {
		it("creates and retrieves a gate", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
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

			expect(gate.id).toBeTruthy();
			expect(gate.phaseCompleted).toBe(1);
			expect(gate.status).toBe("pending");

			const fetched = await store.getGate(gate.id);
			expect(fetched?.pipelineRunId).toBe(pipeline.id);
		});

		it("lists gates for a pipeline", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "approved",
				artifactVersionIds: [],
			});
			await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 2,
				phaseNext: 3,
				status: "pending",
				artifactVersionIds: [],
			});

			const gates = await store.listGates(pipeline.id);
			expect(gates).toHaveLength(2);
		});

		it("gets pending gate for a pipeline", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 2,
				startedAt: new Date().toISOString(),
			});
			await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 1,
				phaseNext: 2,
				status: "approved",
				artifactVersionIds: [],
			});
			await store.createGate({
				pipelineRunId: pipeline.id,
				phaseCompleted: 2,
				phaseNext: 3,
				status: "pending",
				artifactVersionIds: [],
			});

			const pending = await store.getPendingGate(pipeline.id);
			expect(pending?.phaseCompleted).toBe(2);
			expect(pending?.status).toBe("pending");
		});

		it("returns null when no pending gate", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			expect(await store.getPendingGate(pipeline.id)).toBeNull();
		});

		it("updates gate to approved", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
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
				reviewer: "admin",
				comment: "LGTM",
				decidedAt: new Date().toISOString(),
			});

			const updated = await store.getGate(gate.id);
			expect(updated?.status).toBe("approved");
			expect(updated?.reviewer).toBe("admin");
		});

		it("updates crossCuttingFindings field", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "proj",
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
			const findings = {
				issues: [{ severity: "high", message: "SQL injection" }],
			};
			await store.updateGate(gate.id, { crossCuttingFindings: findings });
			const updated = await store.getGate(gate.id);
			expect(updated?.crossCuttingFindings).toEqual(findings);
		});
	});

	// --- Audit Log ---

	describe("audit log", () => {
		it("writes audit log entries", async () => {
			const pipeline = await store.createPipelineRun({
				projectName: "p",
				pipelineName: "std",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});

			// Should not throw
			await store.writeAuditLog({
				pipelineRunId: pipeline.id,
				actor: "admin",
				action: "approve_gate",
				resourceType: "gate",
				resourceId: "gate-123",
				metadata: { comment: "looks good" },
			});
		});
	});
});
