import { describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../../src/adapters/events/in-memory-event-bus.js";
import type { PipelineEvent } from "../../../src/domain/ports/event-bus.port.js";

describe("InMemoryEventBus", () => {
	it("delivers events to subscribers", () => {
		const bus = new InMemoryEventBus();
		const received: PipelineEvent[] = [];

		bus.subscribe((event) => received.push(event));
		bus.emit({
			type: "pipeline_updated",
			pipelineRunId: "run-1",
			status: "running",
		});

		expect(received).toHaveLength(1);
		expect(received[0].type).toBe("pipeline_updated");
	});

	it("delivers events to multiple subscribers", () => {
		const bus = new InMemoryEventBus();
		const received1: PipelineEvent[] = [];
		const received2: PipelineEvent[] = [];

		bus.subscribe((e) => received1.push(e));
		bus.subscribe((e) => received2.push(e));
		bus.emit({ type: "gate_opened", gateId: "g-1", pipelineRunId: "run-1" });

		expect(received1).toHaveLength(1);
		expect(received2).toHaveLength(1);
	});

	it("unsubscribe stops delivery", () => {
		const bus = new InMemoryEventBus();
		const received: PipelineEvent[] = [];

		const unsub = bus.subscribe((e) => received.push(e));
		bus.emit({
			type: "pipeline_updated",
			pipelineRunId: "run-1",
			status: "running",
		});
		expect(received).toHaveLength(1);

		unsub();
		bus.emit({
			type: "pipeline_updated",
			pipelineRunId: "run-1",
			status: "completed",
		});
		expect(received).toHaveLength(1); // no new events
	});

	it("supports all event types", () => {
		const bus = new InMemoryEventBus();
		const received: PipelineEvent[] = [];
		bus.subscribe((e) => received.push(e));

		const events: PipelineEvent[] = [
			{ type: "pipeline_updated", pipelineRunId: "r1", status: "running" },
			{ type: "run_updated", runId: "ar1", status: "succeeded" },
			{ type: "gate_opened", gateId: "g1", pipelineRunId: "r1" },
			{ type: "gate_decided", gateId: "g1", decision: "approved" },
			{ type: "node_online", nodeName: "local" },
			{ type: "node_degraded", nodeName: "local" },
			{ type: "node_offline", nodeName: "local" },
		];

		for (const event of events) {
			bus.emit(event);
		}

		expect(received).toHaveLength(7);
		expect(received.map((e) => e.type)).toEqual([
			"pipeline_updated",
			"run_updated",
			"gate_opened",
			"gate_decided",
			"node_online",
			"node_degraded",
			"node_offline",
		]);
	});

	it("does not throw if subscriber throws", () => {
		const bus = new InMemoryEventBus();
		const good: PipelineEvent[] = [];

		bus.subscribe(() => {
			throw new Error("bad subscriber");
		});
		bus.subscribe((e) => good.push(e));

		expect(() => {
			bus.emit({
				type: "pipeline_updated",
				pipelineRunId: "r1",
				status: "running",
			});
		}).not.toThrow();

		expect(good).toHaveLength(1);
	});
});
