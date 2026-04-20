/**
 * SSE Routes — Server-Sent Events endpoint for real-time dashboard updates.
 * Subscribes to the event bus and forwards events to connected clients.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { IEventBus } from "../../domain/ports/event-bus.port.js";

/**
 * Handles a GET /api/v1/events request by establishing an SSE connection.
 * The connection stays open and forwards events from the event bus.
 */
export function registerSSERoutes(
	req: IncomingMessage,
	res: ServerResponse,
	eventBus: IEventBus,
): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	// Subscribe to event bus
	const unsubscribe = eventBus.subscribe((event) => {
		const data = JSON.stringify(event);
		res.write(`data: ${data}\n\n`);
	});

	// Keepalive every 30s to prevent proxy/load-balancer timeouts
	const keepalive = setInterval(() => {
		res.write(": keepalive\n\n");
	}, 30_000);

	// Cleanup on disconnect
	req.on("close", () => {
		unsubscribe();
		clearInterval(keepalive);
	});
}
