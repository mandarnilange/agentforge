import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDefinitionStore } from "../../src/definitions/file-store.js";
import type { AgentDefinitionYaml } from "../../src/definitions/parser.js";

const TEST_FILE = "/tmp/sdlc-agent-definitions-test.json";

function makeAgentDef(name: string): AgentDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "AgentDefinition",
		metadata: { name, phase: "1" },
		spec: {
			executor: "pi-ai",
			systemPrompt: { file: `prompts/${name}.system.md` },
			outputs: [{ type: "result" }],
		},
	} as AgentDefinitionYaml;
}

describe("FileDefinitionStore", () => {
	beforeEach(() => {
		if (existsSync(TEST_FILE)) rmSync(TEST_FILE);
	});

	afterEach(() => {
		if (existsSync(TEST_FILE)) rmSync(TEST_FILE);
	});

	it("stores and retrieves an agent definition", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addAgent(makeAgentDef("analyst"));
		expect(store.getAgent("analyst")?.metadata.name).toBe("analyst");
	});

	it("persists across store instances (survives process restart)", () => {
		const store1 = createFileDefinitionStore(TEST_FILE);
		store1.addAgent(makeAgentDef("analyst"));
		store1.addAgent(makeAgentDef("architect"));

		// Simulate new process — create fresh store pointing to same file
		const store2 = createFileDefinitionStore(TEST_FILE);
		expect(store2.listAgents()).toHaveLength(2);
		expect(store2.getAgent("analyst")?.metadata.name).toBe("analyst");
		expect(store2.getAgent("architect")?.metadata.name).toBe("architect");
	});

	it("persists pipeline and node definitions", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addPipeline({
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "standard-sdlc" },
			spec: { phases: [] },
		});
		store.addNode({
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition",
			metadata: { name: "local", type: "local" },
			spec: { connection: { type: "local" }, capabilities: [] },
		});

		const store2 = createFileDefinitionStore(TEST_FILE);
		expect(store2.getPipeline("standard-sdlc")).toBeDefined();
		expect(store2.getNode("local")).toBeDefined();
	});

	it("clear removes all definitions from disk", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addAgent(makeAgentDef("analyst"));
		store.clear();

		const store2 = createFileDefinitionStore(TEST_FILE);
		expect(store2.listAgents()).toHaveLength(0);
	});

	it("listPipelines returns all stored pipelines", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addPipeline({
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "standard-sdlc" },
			spec: { phases: [] },
		});
		store.addPipeline({
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "fast-sdlc" },
			spec: { phases: [] },
		});
		expect(store.listPipelines()).toHaveLength(2);
	});

	it("listNodes returns all stored nodes", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addNode({
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition",
			metadata: { name: "local", type: "local" },
			spec: { connection: { type: "local" }, capabilities: [] },
		});
		expect(store.listNodes()).toHaveLength(1);
	});

	it("addPipeline updates existing pipeline (overwrite branch)", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addPipeline({
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "standard-sdlc", displayName: "v1" },
			spec: { phases: [] },
		});
		// Update same name → triggers idx >= 0 branch
		store.addPipeline({
			apiVersion: "agentforge/v1",
			kind: "PipelineDefinition",
			metadata: { name: "standard-sdlc", displayName: "v2" },
			spec: { phases: [{ phase: 1, agents: ["analyst"] }] },
		});
		const pipelines = store.listPipelines();
		expect(pipelines).toHaveLength(1);
		expect(pipelines[0].metadata.displayName).toBe("v2");
	});

	it("addNode updates existing node (overwrite branch)", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addNode({
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition",
			metadata: { name: "local", type: "local", displayName: "v1" },
			spec: { connection: { type: "local" }, capabilities: [] },
		});
		// Update same name → triggers idx >= 0 branch
		store.addNode({
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition",
			metadata: { name: "local", type: "local", displayName: "v2" },
			spec: { connection: { type: "local" }, capabilities: ["llm-access"] },
		});
		const nodes = store.listNodes();
		expect(nodes).toHaveLength(1);
		expect(nodes[0].spec.capabilities).toContain("llm-access");
	});

	it("returns empty array for listPipelines when store is empty", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		expect(store.listPipelines()).toHaveLength(0);
	});

	it("returns empty array for listNodes when store is empty", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		expect(store.listNodes()).toHaveLength(0);
	});

	it("addAgent updates existing agent (overwrite branch)", () => {
		const store = createFileDefinitionStore(TEST_FILE);
		store.addAgent(makeAgentDef("analyst"));
		// Add again with same name — triggers idx >= 0 branch
		const updated = makeAgentDef("analyst");
		store.addAgent(updated);
		const agents = store.listAgents();
		expect(agents).toHaveLength(1);
		expect(agents[0].metadata.name).toBe("analyst");
	});

	it("handles corrupted store file gracefully (returns empty store)", () => {
		// Write invalid JSON to the store file
		const { writeFileSync } = require("node:fs");
		writeFileSync(TEST_FILE, "{ not valid json !!!");

		// Creating a store should not throw — it falls back to empty
		const store = createFileDefinitionStore(TEST_FILE);
		expect(store.listAgents()).toHaveLength(0);
		expect(store.listPipelines()).toHaveLength(0);
		expect(store.listNodes()).toHaveLength(0);
	});
});
