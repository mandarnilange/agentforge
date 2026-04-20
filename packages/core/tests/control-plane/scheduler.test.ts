import { describe, expect, it } from "vitest";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
} from "../../src/definitions/parser.js";

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

const LOCAL_NODE = makeNode("local", ["llm-access", "git"]);
const DOCKER_NODE = makeNode("local-docker", ["llm-access", "git", "docker"]);

describe("LocalAgentScheduler", () => {
	it("schedules an agent with no required capabilities to any node", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("analyst");
		const node = scheduler.schedule(agent, [LOCAL_NODE]);
		expect(node.metadata.name).toBe("local");
	});

	it("schedules agent requiring docker to node with docker", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("developer", ["docker"]);
		const node = scheduler.schedule(agent, [LOCAL_NODE, DOCKER_NODE]);
		expect(node.metadata.name).toBe("local-docker");
	});

	it("throws when no node satisfies required capabilities", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("developer", ["docker"]);
		expect(() => scheduler.schedule(agent, [LOCAL_NODE])).toThrow(
			/no available node/i,
		);
	});

	it("throws when all nodes are at capacity", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("analyst");
		const fullNode = makeNode("local", ["llm-access"], 2);
		scheduler.recordRunStarted("local");
		scheduler.recordRunStarted("local");

		expect(() => scheduler.schedule(agent, [fullNode])).toThrow(
			/no available node/i,
		);
	});

	it("respects maxConcurrentRuns and picks node with capacity", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("analyst");
		const full = makeNode("busy", ["llm-access"], 1);
		const free = makeNode("free", ["llm-access"], 2);
		scheduler.recordRunStarted("busy");

		const node = scheduler.schedule(agent, [full, free]);
		expect(node.metadata.name).toBe("free");
	});

	it("tracks active runs and decrements on completion", () => {
		const scheduler = new LocalAgentScheduler();
		scheduler.recordRunStarted("local");
		scheduler.recordRunStarted("local");
		expect(scheduler.getActiveRunCount("local")).toBe(2);

		scheduler.recordRunCompleted("local");
		expect(scheduler.getActiveRunCount("local")).toBe(1);
	});

	it("prefers node matching preferred capabilities", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("analyst", [], ["docker"]);
		const node = scheduler.schedule(agent, [LOCAL_NODE, DOCKER_NODE]);
		expect(node.metadata.name).toBe("local-docker");
	});
});

describe("LocalAgentScheduler without registry", () => {
	it("schedules normally when registry not provided", () => {
		const scheduler = new LocalAgentScheduler();
		const agent = makeAgent("analyst");
		const node = scheduler.schedule(agent, [LOCAL_NODE]);
		expect(node.metadata.name).toBe("local");
	});
});
