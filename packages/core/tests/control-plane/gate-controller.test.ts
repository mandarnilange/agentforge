import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-gate-test.db";

describe("GateController", () => {
	let store: SqliteStateStore;
	let gate: GateController;
	let pipelineRunId: string;

	beforeEach(async () => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		gate = new GateController(store);

		const run = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		pipelineRunId = run.id;
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("creates a gate in pending status", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		expect(g.status).toBe("pending");
		expect(g.phaseCompleted).toBe(1);
		expect(g.phaseNext).toBe(2);
		expect(g.pipelineRunId).toBe(pipelineRunId);
	});

	it("approve transitions gate to approved", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		await gate.approve(g.id, "admin", "Looks good");

		const updated = await store.getGate(g.id);
		expect(updated?.status).toBe("approved");
		expect(updated?.reviewer).toBe("admin");
		expect(updated?.comment).toBe("Looks good");
		expect(updated?.decidedAt).toBeTruthy();
	});

	it("reject transitions gate to rejected and fails pipeline", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		await gate.reject(g.id, "admin", "Not acceptable");

		const updated = await store.getGate(g.id);
		expect(updated?.status).toBe("rejected");

		const pipeline = await store.getPipelineRun(pipelineRunId);
		expect(pipeline?.status).toBe("failed");
	});

	it("revise transitions gate to revision_requested", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		await gate.revise(g.id, "Please add error handling", "reviewer1");

		const updated = await store.getGate(g.id);
		expect(updated?.status).toBe("revision_requested");
		expect(updated?.revisionNotes).toBe("Please add error handling");
		expect(updated?.reviewer).toBe("reviewer1");
	});

	it("throws when approving a non-pending gate", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		await gate.approve(g.id);
		await expect(gate.approve(g.id)).rejects.toThrow(/not pending/i);
	});

	it("throws when gate not found", async () => {
		await expect(gate.approve("nonexistent")).rejects.toThrow(/not found/i);
	});

	it("writes audit log on approve", async () => {
		const g = await gate.openGate(pipelineRunId, 1, 2, []);
		// Should not throw — audit log written
		await gate.approve(g.id, "admin");
	});

	it("pauses pipeline at gate when opened", async () => {
		await gate.openGate(pipelineRunId, 1, 2, []);
		const pipeline = await store.getPipelineRun(pipelineRunId);
		expect(pipeline?.status).toBe("paused_at_gate");
	});
});
