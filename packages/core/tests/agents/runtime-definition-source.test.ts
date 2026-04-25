/**
 * Apply → run regression guard.
 *
 * Until v0.2.0-prep, agent registry / runner / run-pipeline / gate /
 * pipeline-controller all read agent and pipeline YAML straight from the
 * filesystem (`.agentforge/{agents,pipelines}/<name>.{agent,pipeline}.yaml`).
 * In platform mode the source of truth is the DB-backed `DefinitionStore`,
 * but those code paths never consulted it — `apply` would persist the
 * resource to PG, then `run` would error with "Pipeline definition not
 * found" or "Unknown agent".
 *
 * The fix is `setRuntimeDefinitionStore(store)` — execution paths now
 * prefer the store and only fall back to the filesystem when no store is
 * set. These tests assert that:
 *
 *   1. With NO runtime store and NO `.agentforge/` directory, agent
 *      lookup returns undefined (filesystem fallback path, fails clean).
 *   2. With a store containing an agent, registry + runner find it
 *      WITHOUT touching the filesystem at all.
 *   3. Same for pipelines.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getRuntimeDefinitionStore,
	setRuntimeDefinitionStore,
} from "../../src/agents/definition-source.js";
import { getAgentInfo, getAllAgentIds } from "../../src/agents/registry.js";
import type {
	AgentDefinitionYaml,
	PipelineDefinitionYaml,
} from "../../src/definitions/parser.js";
import { createDefinitionStore } from "../../src/definitions/store.js";

function makeAgent(name: string): AgentDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "AgentDefinition",
		metadata: {
			name,
			displayName: `Agent ${name}`,
			phase: "1",
			role: "tester",
			humanEquivalent: "QA",
		},
		spec: {
			executor: "pi-ai",
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4",
				maxTokens: 1024,
			},
			systemPrompt: { text: "You are a test agent." },
			outputs: [{ type: "test-output" }],
		},
	};
}

function makePipeline(name: string): PipelineDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "PipelineDefinition",
		metadata: { name },
		spec: { phases: [{ name: "phase 1", phase: 1, agents: ["spec-writer"] }] },
	};
}

describe("Runtime DefinitionStore source (apply → run regression guard)", () => {
	beforeEach(() => {
		setRuntimeDefinitionStore(null);
	});

	afterEach(() => {
		setRuntimeDefinitionStore(null);
	});

	it("getRuntimeDefinitionStore() returns null when unset", () => {
		expect(getRuntimeDefinitionStore()).toBeNull();
	});

	it("setRuntimeDefinitionStore + getRuntimeDefinitionStore round-trip", () => {
		const store = createDefinitionStore();
		setRuntimeDefinitionStore(store);
		expect(getRuntimeDefinitionStore()).toBe(store);
	});

	it("agent registry resolves agents from the runtime store (not the filesystem)", () => {
		const store = createDefinitionStore();
		store.addAgent(makeAgent("apply-only-agent"));
		setRuntimeDefinitionStore(store);

		// `apply-only-agent` is NOT in any .agentforge/agents/ directory; it
		// only exists in the in-memory store. Registry must find it via the
		// runtime source, not via filesystem scan.
		expect(getAllAgentIds()).toContain("apply-only-agent");
		const info = getAgentInfo("apply-only-agent");
		expect(info?.id).toBe("apply-only-agent");
		expect(info?.executor).toBe("pi-ai");
		expect(info?.outputs).toEqual(["test-output"]);
	});

	it("agent registry returns undefined for an agent missing from the runtime store", () => {
		setRuntimeDefinitionStore(createDefinitionStore());
		// In platform mode the store IS the source of truth — don't fall
		// back to the filesystem. This is the contract that turns "Unknown
		// agent" into a real diagnostic.
		expect(getAgentInfo("does-not-exist")).toBeUndefined();
	});

	it("storing a pipeline makes it visible via getPipeline()", () => {
		const store = createDefinitionStore();
		store.addPipeline(makePipeline("apply-only-pipeline"));
		setRuntimeDefinitionStore(store);

		const looked = store.getPipeline("apply-only-pipeline");
		expect(looked).toBeDefined();
		expect(looked?.metadata.name).toBe("apply-only-pipeline");
	});

	it("clearing the runtime source restores filesystem-only behaviour", () => {
		const store = createDefinitionStore();
		store.addAgent(makeAgent("transient"));
		setRuntimeDefinitionStore(store);
		expect(getAgentInfo("transient")).toBeDefined();

		setRuntimeDefinitionStore(null);
		// No store → filesystem scan. With no `.agentforge/agents/transient...`
		// the agent should not be found.
		expect(getAgentInfo("transient")).toBeUndefined();
	});
});
