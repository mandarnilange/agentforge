/**
 * Tests for PostgresEventBus — LISTEN/NOTIFY-backed IEventBus (P45-T3).
 *
 * Verifies the contract:
 *   - emit() issues `NOTIFY <channel>, <jsonpayload>` so peer replicas
 *     subscribed to the same channel receive the event.
 *   - subscribe() registers a notification handler and returns an
 *     unsubscribe function.
 *   - The same JSON shape that peers receive round-trips through
 *     in-process subscribers (so dashboards in the emitting process
 *     don't have to wait for the LISTEN round-trip).
 */
import type {
	IEventBus,
	PipelineEvent,
} from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClientQuery, mockClientOn, mockConnect, mockEnd } = vi.hoisted(
	() => ({
		mockClientQuery: vi.fn().mockResolvedValue({ rows: [] }),
		mockClientOn: vi.fn(),
		mockConnect: vi.fn(),
		mockEnd: vi.fn().mockResolvedValue(undefined),
	}),
);

vi.mock("pg", () => {
	class MockClient {
		query = mockClientQuery;
		on = mockClientOn;
		connect = mockConnect.mockResolvedValue(undefined);
		end = mockEnd;
	}
	return { default: { Client: MockClient } };
});

import { PostgresEventBus } from "../../../src/adapters/events/postgres-event-bus.js";

describe("PostgresEventBus", () => {
	let bus: IEventBus & PostgresEventBus;

	beforeEach(async () => {
		vi.clearAllMocks();
		bus = new PostgresEventBus("postgresql://localhost/test", "agentforge");
		await bus.start();
	});

	it("LISTENs on the configured channel after start", () => {
		const sql = mockClientQuery.mock.calls.map((c) => c[0]).join("\n");
		expect(sql).toMatch(/^LISTEN/im);
		expect(sql).toMatch(/agentforge/);
	});

	it("emit issues NOTIFY with a JSON payload", async () => {
		const event: PipelineEvent = {
			type: "run_updated",
			runId: "r1",
			status: "succeeded",
		};
		bus.emit(event);
		// emit is sync but issues query asynchronously — flush microtasks
		await new Promise((r) => setImmediate(r));
		const notifyCall = mockClientQuery.mock.calls.find((c) =>
			(c[0] as string).startsWith("SELECT pg_notify"),
		);
		expect(notifyCall).toBeDefined();
		const params = notifyCall?.[1] as unknown[];
		const payload = JSON.parse(params[1] as string);
		expect(payload.type).toBe("run_updated");
		expect(payload.runId).toBe("r1");
	});

	it("delivers locally-emitted events to in-process subscribers", () => {
		const received: PipelineEvent[] = [];
		bus.subscribe((e) => received.push(e));
		bus.emit({ type: "node_online", nodeName: "alpha" });
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			type: "node_online",
			nodeName: "alpha",
		});
	});

	it("delivers events received via NOTIFY to subscribers", async () => {
		const received: PipelineEvent[] = [];
		bus.subscribe((e) => received.push(e));
		// Replay the notification handler bound to client.on('notification', ...)
		const handler = mockClientOn.mock.calls.find(
			(c) => c[0] === "notification",
		)?.[1] as (msg: { payload: string }) => void;
		expect(handler).toBeDefined();
		handler({
			payload: JSON.stringify({
				type: "node_offline",
				nodeName: "beta",
			}),
		});
		expect(received).toEqual([{ type: "node_offline", nodeName: "beta" }]);
	});

	it("subscribe returns an unsubscribe function", () => {
		const received: PipelineEvent[] = [];
		const unsub = bus.subscribe((e) => received.push(e));
		bus.emit({ type: "node_online", nodeName: "alpha" });
		unsub();
		bus.emit({ type: "node_online", nodeName: "beta" });
		expect(received).toHaveLength(1);
	});

	it("ignores malformed payloads from the LISTEN channel", () => {
		const received: PipelineEvent[] = [];
		bus.subscribe((e) => received.push(e));
		const handler = mockClientOn.mock.calls.find(
			(c) => c[0] === "notification",
		)?.[1] as (msg: { payload: string }) => void;
		handler({ payload: "{ this is not json" });
		expect(received).toHaveLength(0);
	});
});
