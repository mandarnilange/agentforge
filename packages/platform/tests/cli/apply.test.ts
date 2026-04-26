import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefinitionStore } from "@mandarnilange/agentforge-core/definitions/store.js";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerApplyCommand } from "../../src/cli/commands/apply.js";

const validAgentYaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  displayName: Analyst
  description: Business Analyst Agent
  phase: "1"
  role: business-analyst
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
      schema: schemas/frd.schema.ts
`;

const validPipelineYaml = `
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: standard-sdlc
  displayName: Standard SDLC Pipeline
spec:
  input:
    - name: brief
      type: raw-brief
      required: true
  phases:
    - name: requirements
      phase: 1
      agents:
        - analyst
      gate:
        required: true
`;

const validNodeYaml = `
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local-node
  type: local
spec:
  connection:
    type: local
  capabilities:
    - llm-access
`;

describe("sdlc-agent apply command", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `sdlc-apply-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registers the apply command on a program", () => {
		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);
		const applyCmd = program.commands.find((c) => c.name() === "apply");
		expect(applyCmd).toBeDefined();
	});

	it("loads a single YAML file via apply", async () => {
		const filePath = join(tmpDir, "analyst.agent.yaml");
		writeFileSync(filePath, validAgentYaml);
		// Apply now hard-fails if a `systemPrompt.file:` reference can't be
		// resolved; ship the prompt content next to the yaml so apply can
		// inline it (matches what users would do with a real template root).
		mkdirSync(join(tmpDir, "prompts"), { recursive: true });
		writeFileSync(
			join(tmpDir, "prompts", "analyst.system.md"),
			"You are an analyst.",
		);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await program.parseAsync(["apply", "-f", filePath], { from: "user" });

		expect(store.listAgents()).toHaveLength(1);
		expect(store.getAgent("analyst")).toBeDefined();
	});

	it("loads a directory of YAML files via apply", async () => {
		writeFileSync(join(tmpDir, "analyst.agent.yaml"), validAgentYaml);
		writeFileSync(join(tmpDir, "pipeline.yaml"), validPipelineYaml);
		mkdirSync(join(tmpDir, "prompts"), { recursive: true });
		writeFileSync(
			join(tmpDir, "prompts", "analyst.system.md"),
			"You are an analyst.",
		);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await program.parseAsync(["apply", "-f", tmpDir], { from: "user" });

		expect(store.listAgents()).toHaveLength(1);
		expect(store.listPipelines()).toHaveLength(1);
	});

	it("loads a directory containing a node YAML file", async () => {
		writeFileSync(join(tmpDir, "node.yaml"), validNodeYaml);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await program.parseAsync(["apply", "-f", tmpDir], { from: "user" });

		expect(store.listNodes()).toHaveLength(1);
		expect(store.getNode("local-node")).toBeDefined();
	});

	it("loads a single PipelineDefinition YAML file", async () => {
		const filePath = join(tmpDir, "pipeline.yaml");
		writeFileSync(filePath, validPipelineYaml);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await program.parseAsync(["apply", "-f", filePath], { from: "user" });

		expect(store.listPipelines()).toHaveLength(1);
		expect(store.getPipeline("standard-sdlc")).toBeDefined();
	});

	it("loads a single NodeDefinition YAML file", async () => {
		const filePath = join(tmpDir, "node.yaml");
		writeFileSync(filePath, validNodeYaml);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await program.parseAsync(["apply", "-f", filePath], { from: "user" });

		expect(store.listNodes()).toHaveLength(1);
		expect(store.getNode("local-node")).toBeDefined();
	});

	it("rejects invalid YAML with an error", async () => {
		const filePath = join(tmpDir, "bad.yaml");
		writeFileSync(
			filePath,
			`
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  displayName: Missing Name
spec:
  outputs: []
`,
		);

		const program = new Command();
		program.exitOverride(); // prevent process.exit
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await expect(
			program.parseAsync(["apply", "-f", filePath], { from: "user" }),
		).rejects.toThrow();
	});

	it("hard-fails apply when systemPrompt.file cannot be resolved", async () => {
		// Agent yaml references prompts/analyst.system.md but that file is
		// NOT staged. apply should refuse to persist instead of silently
		// shipping an agent with an unresolvable prompt (which would just
		// surface as a runtime error later).
		const filePath = join(tmpDir, "analyst.agent.yaml");
		writeFileSync(filePath, validAgentYaml);

		const program = new Command();
		const store = createDefinitionStore();
		registerApplyCommand(program, store);

		await expect(
			program.parseAsync(["apply", "-f", filePath], { from: "user" }),
		).rejects.toThrow(
			/prompt file 'prompts\/analyst\.system\.md' .* not found/,
		);

		// And nothing was persisted on the way to the throw.
		expect(store.listAgents()).toHaveLength(0);
	});
});
