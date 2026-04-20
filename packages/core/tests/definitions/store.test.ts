import { beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinitionYaml } from "../../src/definitions/parser.js";
import {
	createDefinitionStore,
	type DefinitionStore,
} from "../../src/definitions/store.js";

function makeAgentDef(name: string): AgentDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "AgentDefinition",
		metadata: {
			name,
			phase: "1",
		},
		spec: {
			executor: "pi-ai",
			systemPrompt: { file: `prompts/${name}.system.md` },
			outputs: [{ type: "result" }],
		},
	} as AgentDefinitionYaml;
}

describe("DefinitionStore", () => {
	let store: DefinitionStore;

	beforeEach(() => {
		store = createDefinitionStore();
	});

	it("stores and retrieves an agent definition", () => {
		const agent = makeAgentDef("analyst");
		store.addAgent(agent);
		const retrieved = store.getAgent("analyst");
		expect(retrieved).toBeDefined();
		expect(retrieved?.metadata.name).toBe("analyst");
	});

	it("returns undefined for unknown agent", () => {
		expect(store.getAgent("nonexistent")).toBeUndefined();
	});

	it("lists all agent definitions", () => {
		store.addAgent(makeAgentDef("analyst"));
		store.addAgent(makeAgentDef("architect"));
		const all = store.listAgents();
		expect(all).toHaveLength(2);
		expect(all.map((a) => a.metadata.name).sort()).toEqual([
			"analyst",
			"architect",
		]);
	});

	it("overwrites agent with same name", () => {
		const agent1 = makeAgentDef("analyst");
		agent1.metadata.displayName = "Analyst v1";
		store.addAgent(agent1);

		const agent2 = makeAgentDef("analyst");
		agent2.metadata.displayName = "Analyst v2";
		store.addAgent(agent2);

		const all = store.listAgents();
		expect(all).toHaveLength(1);
		expect(all[0].metadata.displayName).toBe("Analyst v2");
	});

	it("stores and retrieves a pipeline definition", () => {
		const pipeline = {
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition" as const,
			metadata: { name: "standard-sdlc" },
			spec: { phases: [] },
		};
		store.addPipeline(pipeline);
		expect(store.getPipeline("standard-sdlc")).toBeDefined();
		expect(store.listPipelines()).toHaveLength(1);
	});

	it("stores and retrieves a node definition", () => {
		const node = {
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition" as const,
			metadata: { name: "local", type: "local" },
			spec: { connection: { type: "local" }, capabilities: [] },
		};
		store.addNode(node);
		expect(store.getNode("local")).toBeDefined();
		expect(store.listNodes()).toHaveLength(1);
	});

	it("clears all definitions", () => {
		store.addAgent(makeAgentDef("analyst"));
		store.clear();
		expect(store.listAgents()).toHaveLength(0);
	});
});
