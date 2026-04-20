import { existsSync, rmSync } from "node:fs";
import { InMemoryEventBus } from "agentforge-core/adapters/events/in-memory-event-bus.js";
import type { PipelineEvent } from "agentforge-core/domain/ports/event-bus.port.js";
import { SqliteStateStore } from "agentforge-core/state/store.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeHealthMonitor } from "../../src/control-plane/node-health-monitor.js";

const TEST_DB = "/tmp/sdlc-node-health-test.db";

describe("NodeHealthMonitor (P18-T11)", () => {
	let store: SqliteStateStore;
	let eventBus: InMemoryEventBus;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
		eventBus = new InMemoryEventBus();
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("marks node as degraded when heartbeat is late (>30s)", async () => {
		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: ["llm-access", "gpu"],
			status: "online",
			activeRuns: 0,
			lastHeartbeat: new Date(Date.now() - 45_000).toISOString(), // 45s ago
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		const node = await store.getNode("gpu-1");
		expect(node?.status).toBe("degraded");
	});

	it("marks node as offline when heartbeat is missed (>120s)", async () => {
		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: ["llm-access"],
			status: "online",
			activeRuns: 0,
			lastHeartbeat: new Date(Date.now() - 150_000).toISOString(), // 150s ago
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		const node = await store.getNode("gpu-1");
		expect(node?.status).toBe("offline");
	});

	it("keeps node online when heartbeat is recent", async () => {
		await store.upsertNode({
			name: "local",
			type: "local",
			capabilities: ["llm-access"],
			status: "online",
			activeRuns: 1,
			lastHeartbeat: new Date(Date.now() - 5_000).toISOString(), // 5s ago
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		const node = await store.getNode("local");
		expect(node?.status).toBe("online");
	});

	it("emits node_degraded event on status transition", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: [],
			status: "online",
			activeRuns: 0,
			lastHeartbeat: new Date(Date.now() - 45_000).toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("node_degraded");
	});

	it("emits node_offline event and marks running agent runs as failed", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: [],
			status: "online",
			activeRuns: 1,
			lastHeartbeat: new Date(Date.now() - 150_000).toISOString(),
			updatedAt: new Date().toISOString(),
		});

		// Create a running agent run on this node
		const pipeline = await store.createPipelineRun({
			projectName: "test",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});
		const agentRun = await store.createAgentRun({
			pipelineRunId: pipeline.id,
			agentName: "developer",
			phase: 1,
			nodeName: "gpu-1",
			status: "running",
			inputArtifactIds: [],
			outputArtifactIds: [],
			startedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		const node = await store.getNode("gpu-1");
		expect(node?.status).toBe("offline");

		const nodeEvents = events.filter((e) => e.type === "node_offline");
		expect(nodeEvents).toHaveLength(1);

		// Agent run on the offline node should be failed
		const updatedRun = await store.getAgentRun(agentRun.id);
		expect(updatedRun?.status).toBe("failed");
		expect(updatedRun?.error).toContain("node offline");
	});

	it("does not re-emit events if status hasn't changed", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: [],
			status: "degraded", // already degraded
			activeRuns: 0,
			lastHeartbeat: new Date(Date.now() - 45_000).toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		// No event emitted because status didn't change
		expect(events).toHaveLength(0);
	});

	it("transitions node back to online when heartbeat resumes", async () => {
		const events: PipelineEvent[] = [];
		eventBus.subscribe((e) => events.push(e));

		await store.upsertNode({
			name: "gpu-1",
			type: "remote",
			capabilities: [],
			status: "offline", // was offline
			activeRuns: 0,
			lastHeartbeat: new Date(Date.now() - 5_000).toISOString(), // now recent
			updatedAt: new Date().toISOString(),
		});

		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		await monitor.checkHealth();

		const node = await store.getNode("gpu-1");
		expect(node?.status).toBe("online");

		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("node_online");
	});

	it("start() and stop() control the health check interval without throwing", async () => {
		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		monitor.start(10); // short interval so callback fires
		await new Promise((resolve) => setTimeout(resolve, 40));
		monitor.stop();
		monitor.stop(); // idempotent
	});

	it("stop() is a no-op when not started", () => {
		const monitor = new NodeHealthMonitor(store, eventBus, {
			degradedThresholdMs: 30_000,
			offlineThresholdMs: 120_000,
		});
		expect(() => monitor.stop()).not.toThrow();
	});
});
