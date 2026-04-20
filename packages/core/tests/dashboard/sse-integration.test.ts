import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../src/adapters/events/in-memory-event-bus.js";
import { createDashboardServer } from "../../src/dashboard/server.js";
import { SqliteStateStore } from "../../src/state/store.js";

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

describe("Dashboard server SSE integration", () => {
	let server: Server;
	let store: SqliteStateStore;
	let bus: InMemoryEventBus;

	beforeEach(() => {
		return new Promise<void>((resolve) => {
			store = new SqliteStateStore(":memory:");
			bus = new InMemoryEventBus();
			server = createDashboardServer({ store, eventBus: bus });
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(() => {
		return new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => {
				store.close();
				resolve();
			});
		});
	});

	it("serves SSE stream at /api/v1/events", async () => {
		const port = getPort(server);

		const { headers } = await new Promise<{
			headers: Record<string, string | string[] | undefined>;
		}>((resolve) => {
			const req = httpRequest(
				{ hostname: "127.0.0.1", port, path: "/api/v1/events" },
				(res) => {
					resolve({ headers: res.headers });
					res.once("data", () => res.destroy());
				},
			);
			req.end();
			setTimeout(() => {
				bus.emit({
					type: "pipeline_updated",
					pipelineRunId: "r-1",
					status: "completed",
				});
			}, 30);
		});

		expect(headers["content-type"]).toBe("text/event-stream");
		expect(headers["cache-control"]).toBe("no-cache");
	});

	it("forwards events from event bus to SSE clients", async () => {
		const port = getPort(server);

		const data = await new Promise<string>((resolve) => {
			const req = httpRequest(
				{ hostname: "127.0.0.1", port, path: "/api/v1/events" },
				(res) => {
					res.on("data", (chunk: Buffer) => {
						resolve(chunk.toString());
						res.destroy();
					});
				},
			);
			req.end();
			setTimeout(() => {
				bus.emit({
					type: "run_updated",
					runId: "run-42",
					status: "completed",
				});
			}, 50);
		});

		expect(data).toContain("data:");
		expect(data).toContain("run_updated");
		expect(data).toContain("run-42");
	});

	it("returns 404 for non-SSE API paths that do not exist", async () => {
		const port = getPort(server);

		const statusCode = await new Promise<number>((resolve) => {
			const req = httpRequest(
				{
					hostname: "127.0.0.1",
					port,
					path: "/api/v1/nonexistent-endpoint",
				},
				(res) => {
					resolve(res.statusCode ?? 500);
					res.destroy();
				},
			);
			req.end();
		});

		expect(statusCode).toBe(404);
	});
});
