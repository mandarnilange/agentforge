/**
 * Tests for buildEventBus — selects the IEventBus adapter based on
 * AGENTFORGE_EVENT_BUS env var (P45-T3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("pg", () => {
	class MockClient {
		query = vi.fn().mockResolvedValue({ rows: [] });
		on = vi.fn();
		connect = vi.fn().mockResolvedValue(undefined);
		end = vi.fn().mockResolvedValue(undefined);
	}
	return { default: { Client: MockClient } };
});

import { InMemoryEventBus } from "@mandarnilange/agentforge-core/adapters/events/in-memory-event-bus.js";
import { buildEventBus } from "../../../src/adapters/events/event-bus-factory.js";
import { PostgresEventBus } from "../../../src/adapters/events/postgres-event-bus.js";

const ORIGINAL_ENV = process.env.AGENTFORGE_EVENT_BUS;

describe("buildEventBus", () => {
	beforeEach(() => {
		delete process.env.AGENTFORGE_EVENT_BUS;
	});
	afterEach(() => {
		if (ORIGINAL_ENV === undefined) delete process.env.AGENTFORGE_EVENT_BUS;
		else process.env.AGENTFORGE_EVENT_BUS = ORIGINAL_ENV;
	});

	it("returns InMemoryEventBus by default", () => {
		const bus = buildEventBus({ postgresUrl: "postgresql://localhost/test" });
		expect(bus).toBeInstanceOf(InMemoryEventBus);
	});

	it("returns InMemoryEventBus when AGENTFORGE_EVENT_BUS=memory", () => {
		process.env.AGENTFORGE_EVENT_BUS = "memory";
		const bus = buildEventBus({ postgresUrl: "postgresql://localhost/test" });
		expect(bus).toBeInstanceOf(InMemoryEventBus);
	});

	it("returns PostgresEventBus when AGENTFORGE_EVENT_BUS=postgres and url is set", () => {
		process.env.AGENTFORGE_EVENT_BUS = "postgres";
		const bus = buildEventBus({ postgresUrl: "postgresql://localhost/test" });
		expect(bus).toBeInstanceOf(PostgresEventBus);
	});

	it("falls back to InMemoryEventBus when AGENTFORGE_EVENT_BUS=postgres but no url", () => {
		process.env.AGENTFORGE_EVENT_BUS = "postgres";
		const bus = buildEventBus({ postgresUrl: undefined });
		expect(bus).toBeInstanceOf(InMemoryEventBus);
	});

	it("rejects unknown event-bus types with a clear error", () => {
		process.env.AGENTFORGE_EVENT_BUS = "kafka";
		expect(() =>
			buildEventBus({ postgresUrl: "postgresql://localhost/test" }),
		).toThrow(/AGENTFORGE_EVENT_BUS.*kafka/);
	});
});
