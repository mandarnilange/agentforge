import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IStateStore } from "../../src/domain/ports/state-store.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

describe("IStateStore audit log listing", () => {
	let store: IStateStore;
	let pipelineId1: string;
	let pipelineId2: string;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		const p1 = await store.createPipelineRun({
			projectName: "project-a",
			pipelineName: "pipeline-a",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		pipelineId1 = p1.id;
		const p2 = await store.createPipelineRun({
			projectName: "project-b",
			pipelineName: "pipeline-b",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		pipelineId2 = p2.id;

		await store.writeAuditLog({
			pipelineRunId: pipelineId1,
			actor: "alice",
			action: "gate.approved",
			resourceType: "gate",
			resourceId: "g-1",
			metadata: { comment: "Looks good" },
		});
		await store.writeAuditLog({
			pipelineRunId: pipelineId1,
			actor: "bob",
			action: "gate.rejected",
			resourceType: "gate",
			resourceId: "g-2",
		});
		await store.writeAuditLog({
			pipelineRunId: pipelineId2,
			actor: "charlie",
			action: "pipeline.stopped",
			resourceType: "pipeline",
			resourceId: pipelineId2,
		});
	});

	afterEach(async () => {
		await store.close();
	});

	it("returns all audit log entries when no filter", async () => {
		const entries = await store.listAuditLog();
		expect(entries).toHaveLength(3);
	});

	it("filters by pipelineRunId", async () => {
		const entries = await store.listAuditLog(pipelineId1);
		expect(entries).toHaveLength(2);
		expect(entries.every((e) => e.pipelineRunId === pipelineId1)).toBe(true);
	});

	it("returns entries sorted by createdAt descending", async () => {
		const entries = await store.listAuditLog();
		for (let i = 1; i < entries.length; i++) {
			expect(entries[i - 1].createdAt >= entries[i].createdAt).toBe(true);
		}
	});

	it("returns entries with all fields populated", async () => {
		const entries = await store.listAuditLog(pipelineId1);
		const approved = entries.find((e) => e.action === "gate.approved");
		expect(approved).toBeDefined();
		expect(approved?.id).toBeTruthy();
		expect(approved?.actor).toBe("alice");
		expect(approved?.resourceType).toBe("gate");
		expect(approved?.resourceId).toBe("g-1");
		expect(approved?.metadata).toEqual({ comment: "Looks good" });
		expect(approved?.createdAt).toBeTruthy();
	});

	it("returns empty array for pipeline with no audit entries", async () => {
		const entries = await store.listAuditLog("nonexistent-id");
		expect(entries).toEqual([]);
	});
});
