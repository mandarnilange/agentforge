/**
 * Tests for the stateless scheduling path (P45-T6).
 *
 * Scheduler.schedule consults an IActiveRunCounter before each decision so
 * two control-plane replicas reading the same DB never disagree about the
 * load on a node.
 */
import { describe, expect, it, vi } from "vitest";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
} from "../../src/definitions/parser.js";
import type { IActiveRunCounter } from "../../src/domain/ports/active-run-counter.port.js";

function makeNode(
	name: string,
	capabilities: string[],
	maxConcurrentRuns = 2,
): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name, type: "local" },
		spec: {
			connection: { type: "local" },
			capabilities,
			resources: { maxConcurrentRuns },
		},
	};
}

function makeAgent(
	name: string,
	requiredCaps: string[] = [],
	preferredCaps: string[] = [],
): AgentDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "AgentDefinition",
		metadata: { name, displayName: name, phase: "1" },
		spec: {
			executor: "pi-ai",
			systemPrompt: { file: `prompts/${name}.md` },
			outputs: [],
			nodeAffinity: {
				required: requiredCaps.map((c) => ({ capability: c })),
				preferred: preferredCaps.map((c) => ({ capability: c })),
			},
		},
	};
}

function fakeCounter(counts: Record<string, number>): IActiveRunCounter {
	return {
		count: vi.fn(async (name: string) => counts[name] ?? 0),
		recordStarted: vi.fn().mockResolvedValue(undefined),
		recordCompleted: vi.fn().mockResolvedValue(undefined),
	};
}

describe("LocalAgentScheduler stateless path (P45-T6)", () => {
	it("schedule queries the counter (not the internal map) before each decision", async () => {
		const counter = fakeCounter({ "node-a": 0 });
		const scheduler = new LocalAgentScheduler(undefined, { counter });
		const node = makeNode("node-a", ["llm-access"]);
		const picked = await scheduler.schedule(makeAgent("a"), [node]);
		expect(picked.metadata.name).toBe("node-a");
		expect(counter.count).toHaveBeenCalledWith("node-a");
	});

	it("skips a node when the counter says it has reached maxConcurrentRuns", async () => {
		// node-a is at capacity (2 of 2); node-b is idle (0 of 2).
		const counter = fakeCounter({ "node-a": 2, "node-b": 0 });
		const scheduler = new LocalAgentScheduler(undefined, { counter });
		const nodeA = makeNode("node-a", ["llm-access"], 2);
		const nodeB = makeNode("node-b", ["llm-access"], 2);
		const picked = await scheduler.schedule(makeAgent("a"), [nodeA, nodeB]);
		expect(picked.metadata.name).toBe("node-b");
	});

	it("throws when every candidate is at capacity according to the counter", async () => {
		const counter = fakeCounter({ "node-a": 2 });
		const scheduler = new LocalAgentScheduler(undefined, { counter });
		const nodeA = makeNode("node-a", ["llm-access"], 2);
		await expect(scheduler.schedule(makeAgent("a"), [nodeA])).rejects.toThrow(
			/no available node/i,
		);
	});

	it("re-reads counts on each call (no internal staleness across replicas)", async () => {
		const counts: Record<string, number> = { "node-a": 0 };
		const counter = fakeCounter(counts);
		const scheduler = new LocalAgentScheduler(undefined, { counter });
		const node = makeNode("node-a", ["llm-access"], 2);
		await scheduler.schedule(makeAgent("a"), [node]);
		// Simulate another replica claiming a slot on node-a.
		counts["node-a"] = 2;
		await expect(scheduler.schedule(makeAgent("a"), [node])).rejects.toThrow(
			/no available node/i,
		);
		expect(counter.count).toHaveBeenCalledTimes(2);
	});

	it("treats a single failing counter call as 'capacity unknown' and skips that node", async () => {
		const counter: IActiveRunCounter = {
			count: vi.fn(async (name: string) => {
				if (name === "node-a") throw new Error("DB hiccup");
				return 0;
			}),
			recordStarted: vi.fn().mockResolvedValue(undefined),
			recordCompleted: vi.fn().mockResolvedValue(undefined),
		};
		const scheduler = new LocalAgentScheduler(undefined, { counter });
		const nodeA = makeNode("node-a", ["llm-access"], 2);
		const nodeB = makeNode("node-b", ["llm-access"], 2);
		// node-a's counter rejected; node-b is healthy and idle → must be picked.
		const picked = await scheduler.schedule(makeAgent("a"), [nodeA, nodeB]);
		expect(picked.metadata.name).toBe("node-b");
	});
});
