import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDashboardServer } from "../../src/dashboard/server.js";
import type { AuditLog } from "../../src/domain/ports/state-store.port.js";
import { SqliteStateStore } from "../../src/state/store.js";

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

function get(
	port: number,
	path: string,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const req = httpRequest({ hostname: "127.0.0.1", port, path }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				resolve({ status: res.statusCode ?? 500, body: JSON.parse(raw) });
			});
		});
		req.on("error", reject);
		req.end();
	});
}

describe("GET /api/v1/audit-log", () => {
	let server: Server;
	let store: SqliteStateStore;
	let pipelineId: string;

	beforeEach(async () => {
		store = new SqliteStateStore(":memory:");
		const p = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "test-pipeline",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		pipelineId = p.id;

		await store.writeAuditLog({
			pipelineRunId: pipelineId,
			actor: "alice",
			action: "gate.approved",
			resourceType: "gate",
			resourceId: "g-1",
		});

		server = createDashboardServer({ store });
		await new Promise<void>((resolve) => {
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await store.close();
	});

	it("returns all audit entries without filter", async () => {
		const port = getPort(server);
		const { status, body } = await get(port, "/api/v1/audit-log");
		expect(status).toBe(200);
		const entries = body as AuditLog[];
		expect(entries).toHaveLength(1);
		expect(entries[0].action).toBe("gate.approved");
	});

	it("filters by pipelineId query param", async () => {
		const port = getPort(server);
		const { status, body } = await get(
			port,
			`/api/v1/audit-log?pipelineId=${pipelineId}`,
		);
		expect(status).toBe(200);
		expect((body as AuditLog[]).length).toBe(1);
	});

	it("returns empty for nonexistent pipeline", async () => {
		const port = getPort(server);
		const { status, body } = await get(
			port,
			"/api/v1/audit-log?pipelineId=nonexistent",
		);
		expect(status).toBe(200);
		expect(body).toEqual([]);
	});
});
