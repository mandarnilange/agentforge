import { createServer, request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../src/adapters/events/in-memory-event-bus.js";
import { registerSSERoutes } from "../../src/dashboard/routes/sse-routes.js";

function getPort(server: Server): number {
	const addr = server.address();
	if (typeof addr === "object" && addr) return addr.port;
	throw new Error("Server not listening");
}

describe("SSE Routes (P18-T5)", () => {
	let server: Server;
	let bus: InMemoryEventBus;

	beforeEach(() => {
		return new Promise<void>((resolve) => {
			bus = new InMemoryEventBus();
			server = createServer((req, res) => {
				if (req.url === "/api/v1/events") {
					registerSSERoutes(req, res, bus);
				} else {
					res.writeHead(404);
					res.end();
				}
			});
			server.listen(0, "127.0.0.1", resolve);
		});
	});

	afterEach(() => {
		return new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		});
	});

	it("returns SSE response headers", async () => {
		const port = getPort(server);

		// Emit an event shortly after connection to trigger data flow and unblock
		const { headers } = await new Promise<{
			headers: Record<string, string | string[] | undefined>;
		}>((resolve) => {
			const req = httpRequest(
				{ hostname: "127.0.0.1", port, path: "/api/v1/events" },
				(res) => {
					resolve({ headers: res.headers });
					// Read at least one chunk then destroy to clean up
					res.once("data", () => res.destroy());
				},
			);
			req.end();
			// Emit event to unblock the read
			setTimeout(() => {
				bus.emit({ type: "pipeline_updated", pipelineRunId: "r", status: "x" });
			}, 30);
		});

		expect(headers["content-type"]).toBe("text/event-stream");
		expect(headers["cache-control"]).toBe("no-cache");
		expect(headers.connection).toBe("keep-alive");
	});

	it("streams events emitted to the event bus", async () => {
		const port = getPort(server);

		const receivedData = await new Promise<string>((resolve) => {
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

			// Give connection a moment to establish, then emit event
			setTimeout(() => {
				bus.emit({
					type: "pipeline_updated",
					pipelineRunId: "run-1",
					status: "completed",
				});
			}, 50);
		});

		expect(receivedData).toContain("data:");
		expect(receivedData).toContain("pipeline_updated");
		expect(receivedData).toContain("run-1");
	});

	it("delivers multiple event types", async () => {
		const port = getPort(server);
		const chunks: string[] = [];

		await new Promise<void>((resolve) => {
			const req = httpRequest(
				{ hostname: "127.0.0.1", port, path: "/api/v1/events" },
				(res) => {
					let count = 0;
					res.on("data", (chunk: Buffer) => {
						chunks.push(chunk.toString());
						count++;
						if (count >= 2) {
							res.destroy();
							resolve();
						}
					});
				},
			);
			req.end();

			setTimeout(() => {
				bus.emit({ type: "gate_opened", gateId: "g-1", pipelineRunId: "r-1" });
				bus.emit({ type: "node_offline", nodeName: "gpu-1" });
			}, 50);
		});

		const allData = chunks.join("");
		expect(allData).toContain("gate_opened");
		expect(allData).toContain("node_offline");
	});
});
