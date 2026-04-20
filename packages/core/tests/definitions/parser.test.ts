import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadDefinitionsFromDir,
	parseAgentDefinition,
	parseDefinitionFile,
	parseNodeDefinition,
	parsePipelineDefinition,
} from "../../src/definitions/parser.js";

const validAgentYaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  displayName: Analyst
  description: Business Analyst Agent
  phase: "1"
  role: business-analyst
  humanEquivalent: BA / Product Manager
spec:
  executor: pi-ai
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384
    thinking: medium
  systemPrompt:
    file: prompts/analyst.system.md
  tools: []
  inputs:
    - type: raw-brief
      required: true
    - type: stakeholder-notes
      required: false
  outputs:
    - type: frd
      schema: schemas/frd.schema.ts
    - type: nfr
      schema: schemas/nfr.schema.ts
  nodeAffinity:
    preferred:
      - capability: llm-access
  resources:
    estimatedTokens: 15000
    estimatedDuration: 60s
    maxRetries: 2
`;

const validPipelineYaml = `
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: standard-sdlc
  displayName: Standard SDLC Pipeline
  description: Full 9-agent SDLC pipeline with human gates
spec:
  input:
    - name: brief
      type: raw-brief
      description: Customer brief
      required: true
  phases:
    - name: requirements
      phase: 1
      agents:
        - analyst
      gate:
        required: true
    - name: architecture
      phase: 2
      agents:
        - architect
      gate:
        required: true
`;

const validNodeYaml = `
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local
  displayName: Local Machine
  type: local
spec:
  connection:
    type: local
  capabilities:
    - llm-access
    - git
  resources:
    maxConcurrentRuns: 2
    maxTokensPerMinute: 100000
`;

describe("YAML Definition Parser", () => {
	describe("parseAgentDefinition", () => {
		it("parses a valid AgentDefinition YAML string", () => {
			const result = parseAgentDefinition(validAgentYaml);
			expect(result.apiVersion).toBe("agentforge/v1");
			expect(result.kind).toBe("AgentDefinition");
			expect(result.metadata.name).toBe("analyst");
			expect(result.metadata.displayName).toBe("Analyst");
			expect(result.metadata.phase).toBe("1");
			expect(result.spec.executor).toBe("pi-ai");
			expect(result.spec.model?.provider).toBe("anthropic");
			expect(result.spec.outputs).toHaveLength(2);
			expect(result.spec.outputs[0].type).toBe("frd");
		});

		it("rejects YAML missing required metadata.name", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  displayName: Analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(invalid)).toThrow();
		});

		it("rejects YAML missing required spec.executor", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(invalid)).toThrow();
		});

		it("rejects YAML with invalid executor value", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: invalid-executor
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(invalid)).toThrow();
		});

		it("rejects YAML missing required spec.outputs", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
`;
			expect(() => parseAgentDefinition(invalid)).toThrow();
		});

		it("rejects YAML with wrong kind", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: analyst
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(invalid)).toThrow();
		});

		it("accepts YAML with definitions + flow (new format)", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: example
  phase: "4"
spec:
  executor: pi-coding-agent
  systemPrompt:
    file: prompts/example.system.md
  outputs:
    - type: code
  definitions:
    run-tests:
      type: script
      run: npx vitest run
      continueOnError: true
    fix-code:
      type: llm
      description: Fix failing tests
    lint:
      type: script
      run: npx biome check .
    type-check:
      type: script
      run: npx tsc --noEmit
  flow:
    - step: run-tests
    - loop:
        until: "{{steps.run-tests.output}}"
        maxIterations: 3
        do:
          - step: fix-code
          - step: run-tests
    - parallel:
        - step: lint
        - step: type-check
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.definitions).toBeDefined();
			expect(result.spec.definitions?.["run-tests"].type).toBe("script");
			expect(result.spec.flow).toHaveLength(3);
			const loopItem = result.spec.flow?.[1] as {
				loop: { maxIterations: number; do: unknown[] };
			};
			expect(loopItem.loop.maxIterations).toBe(3);
			expect(loopItem.loop.do).toHaveLength(2);
		});

		it("rejects flow referencing an undefined step", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: bad-refs
  phase: "4"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/x.system.md
  outputs:
    - type: code
  definitions:
    known:
      type: script
      run: echo hi
  flow:
    - step: not-defined
`;
			expect(() => parseAgentDefinition(invalid)).toThrow(
				/not defined in spec\.definitions/,
			);
		});

		it("rejects flow references inside a nested parallel block", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: bad-nested
  phase: "4"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/x.system.md
  outputs:
    - type: code
  definitions:
    a:
      type: script
      run: echo hi
  flow:
    - parallel:
        - step: a
        - step: missing
`;
			expect(() => parseAgentDefinition(invalid)).toThrow(
				/not defined in spec\.definitions/,
			);
		});

		it("rejects flow references inside a loop body", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: bad-loop
  phase: "4"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/x.system.md
  outputs:
    - type: code
  definitions:
    gen:
      type: script
      run: echo hi
  flow:
    - loop:
        until: "{{steps.gen.output}}"
        maxIterations: 3
        do:
          - step: missing
`;
			expect(() => parseAgentDefinition(invalid)).toThrow(
				/not defined in spec\.definitions/,
			);
		});

		it("accepts YAML with optional fields omitted", () => {
			const minimal = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: minimal-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/minimal.system.md
  outputs:
    - type: result
`;
			const result = parseAgentDefinition(minimal);
			expect(result.metadata.name).toBe("minimal-agent");
			expect(result.spec.tools).toBeUndefined();
			expect(result.spec.inputs).toBeUndefined();
			expect(result.spec.model).toBeUndefined();
		});
	});

	describe("parsePipelineDefinition", () => {
		it("parses a valid PipelineDefinition YAML string", () => {
			const result = parsePipelineDefinition(validPipelineYaml);
			expect(result.kind).toBe("PipelineDefinition");
			expect(result.metadata.name).toBe("standard-sdlc");
			expect(result.spec.phases).toHaveLength(2);
			expect(result.spec.phases[0].agents).toContain("analyst");
		});

		it("rejects pipeline YAML with wrong kind", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: test
spec:
  phases: []
`;
			expect(() => parsePipelineDefinition(invalid)).toThrow();
		});
	});

	describe("parseNodeDefinition", () => {
		it("parses a valid NodeDefinition YAML string", () => {
			const result = parseNodeDefinition(validNodeYaml);
			expect(result.kind).toBe("NodeDefinition");
			expect(result.metadata.name).toBe("local");
			expect(result.spec.capabilities).toContain("llm-access");
			expect(result.spec.connection.type).toBe("local");
		});

		it("rejects node YAML with wrong kind", () => {
			const invalid = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: local
  type: local
spec:
  connection:
    type: local
  capabilities: []
`;
			expect(() => parseNodeDefinition(invalid)).toThrow();
		});
	});

	describe("parseDefinitionFile", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = join(tmpdir(), `sdlc-test-${Date.now()}`);
			mkdirSync(tmpDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("parses an agent definition file", () => {
			const filePath = join(tmpDir, "analyst.agent.yaml");
			writeFileSync(filePath, validAgentYaml);
			const result = parseDefinitionFile(filePath);
			expect(result.kind).toBe("AgentDefinition");
		});

		it("parses a pipeline definition file", () => {
			const filePath = join(tmpDir, "standard.pipeline.yaml");
			writeFileSync(filePath, validPipelineYaml);
			const result = parseDefinitionFile(filePath);
			expect(result.kind).toBe("PipelineDefinition");
		});

		it("parses a node definition file", () => {
			const filePath = join(tmpDir, "local.node.yaml");
			writeFileSync(filePath, validNodeYaml);
			const result = parseDefinitionFile(filePath);
			expect(result.kind).toBe("NodeDefinition");
		});

		it("throws for unsupported kind", () => {
			const filePath = join(tmpDir, "unknown.yaml");
			writeFileSync(
				filePath,
				`
apiVersion: agentforge/v1
kind: UnknownKind
metadata:
  name: test
spec: {}
`,
			);
			expect(() => parseDefinitionFile(filePath)).toThrow(
				/Unsupported definition kind/,
			);
		});

		it("throws when YAML file is missing kind field", () => {
			const filePath = join(tmpDir, "no-kind.yaml");
			writeFileSync(
				filePath,
				`apiVersion: agentforge/v1\nmetadata:\n  name: test\n`,
			);
			expect(() => parseDefinitionFile(filePath)).toThrow(
				/Invalid definition file/,
			);
		});
	});

	describe("loadDefinitionsFromDir", () => {
		let tmpDir: string;

		beforeEach(() => {
			tmpDir = join(tmpdir(), `sdlc-dir-test-${Date.now()}`);
			mkdirSync(tmpDir, { recursive: true });
		});

		afterEach(() => {
			rmSync(tmpDir, { recursive: true, force: true });
		});

		it("loads all YAML files from a directory", () => {
			writeFileSync(join(tmpDir, "analyst.agent.yaml"), validAgentYaml);
			writeFileSync(join(tmpDir, "pipeline.yaml"), validPipelineYaml);
			writeFileSync(join(tmpDir, "local.node.yaml"), validNodeYaml);

			const result = loadDefinitionsFromDir(tmpDir);
			expect(result.agents).toHaveLength(1);
			expect(result.pipelines).toHaveLength(1);
			expect(result.nodes).toHaveLength(1);
			expect(result.agents[0].metadata.name).toBe("analyst");
		});

		it("loads .yml files as well as .yaml files", () => {
			writeFileSync(join(tmpDir, "agent.yml"), validAgentYaml);
			const result = loadDefinitionsFromDir(tmpDir);
			expect(result.agents).toHaveLength(1);
		});

		it("ignores non-YAML files", () => {
			writeFileSync(join(tmpDir, "readme.md"), "# Hello");
			writeFileSync(join(tmpDir, "data.json"), "{}");
			writeFileSync(join(tmpDir, "analyst.agent.yaml"), validAgentYaml);

			const result = loadDefinitionsFromDir(tmpDir);
			expect(result.agents).toHaveLength(1);
			expect(result.pipelines).toHaveLength(0);
			expect(result.nodes).toHaveLength(0);
		});

		it("returns empty arrays for an empty directory", () => {
			const result = loadDefinitionsFromDir(tmpDir);
			expect(result.agents).toHaveLength(0);
			expect(result.pipelines).toHaveLength(0);
			expect(result.nodes).toHaveLength(0);
		});
	});

	describe("inline systemPrompt.text", () => {
		it("accepts systemPrompt with text instead of file", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: inline-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: "You are a helpful business analyst."
  outputs:
    - type: frd
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.systemPrompt).toEqual({
				text: "You are a helpful business analyst.",
			});
			expect(
				(result.spec.systemPrompt as { file?: string }).file,
			).toBeUndefined();
		});

		it("still accepts systemPrompt with file", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: file-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/analyst.system.md
  outputs:
    - type: frd
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.systemPrompt).toEqual({
				file: "prompts/analyst.system.md",
			});
		});

		it("rejects systemPrompt with both file and text", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: both-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/agent.system.md
    text: "You are an agent."
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(yaml)).toThrow();
		});

		it("rejects systemPrompt with neither file nor text", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: empty-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt: {}
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(yaml)).toThrow();
		});

		it("rejects systemPrompt.text that is empty string", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: empty-text
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: ""
  outputs:
    - type: frd
`;
			expect(() => parseAgentDefinition(yaml)).toThrow();
		});

		it("accepts multiline inline text", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: multiline-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: |
      You are a business analyst.
      Focus on: user stories, acceptance criteria.
      Be concise and structured.
  outputs:
    - type: frd
`;
			const result = parseAgentDefinition(yaml);
			const prompt = (result.spec.systemPrompt as { text: string }).text;
			expect(prompt).toContain("business analyst");
			expect(prompt).toContain("acceptance criteria");
		});
	});

	describe("backward compatibility with existing .agentforge/agents YAMLs", () => {
		it("parses every shipped agent definition with the new schema", () => {
			// P33-T6: existing `.agentforge/agents/*.agent.yaml` files must
			// continue to parse cleanly with the new definitions/flow schema.
			const agentsDir = join(
				__dirname,
				"..",
				"..",
				"..",
				"..",
				".agentforge",
				"agents",
			);
			const files = require("node:fs")
				.readdirSync(agentsDir)
				.filter((f: string) => f.endsWith(".yaml"));
			expect(files.length).toBeGreaterThan(0);
			for (const file of files) {
				const def = parseDefinitionFile(join(agentsDir, file));
				expect(def.kind).toBe("AgentDefinition");
			}
		});
	});

	describe("P37 — pipeline spec.wiring schema", () => {
		it("parses pipeline YAML with spec.wiring section", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: wired-pipeline
spec:
  phases:
    - name: requirements
      phase: 1
      agents:
        - analyst
    - name: architecture
      phase: 2
      agents:
        - architect
  wiring:
    architect:
      frd: analyst
      nfr: analyst
`;
			const result = parsePipelineDefinition(yaml);
			expect(result.spec.wiring).toBeDefined();
			expect(result.spec.wiring?.architect).toEqual({
				frd: "analyst",
				nfr: "analyst",
			});
		});

		it("parses pipeline YAML without spec.wiring (backward compat)", () => {
			const result = parsePipelineDefinition(validPipelineYaml);
			expect(result.spec.wiring).toBeUndefined();
			expect(result.spec.phases).toHaveLength(2);
		});
	});

	describe("P38 — resources.budget schema", () => {
		it("accepts resources with budget.maxTotalTokens only", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: budget-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    file: prompts/budget.system.md
  outputs:
    - type: result
  resources:
    budget:
      maxTotalTokens: 50000
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources?.budget?.maxTotalTokens).toBe(50000);
			expect(result.spec.resources?.budget?.maxCostUsd).toBeUndefined();
		});

		it("accepts resources with budget.maxCostUsd only", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: cost-budget-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: You are a test agent.
  outputs:
    - type: result
  resources:
    budget:
      maxCostUsd: 0.15
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources?.budget?.maxCostUsd).toBe(0.15);
			expect(result.spec.resources?.budget?.maxTotalTokens).toBeUndefined();
		});

		it("accepts resources with both budget fields", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: dual-budget-agent
  phase: "4"
spec:
  executor: pi-coding-agent
  systemPrompt:
    text: You are a coding agent.
  outputs:
    - type: code
  resources:
    budget:
      maxTotalTokens: 150000
      maxCostUsd: 0.75
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources?.budget?.maxTotalTokens).toBe(150000);
			expect(result.spec.resources?.budget?.maxCostUsd).toBe(0.75);
		});

		it("silently ignores legacy dead fields (estimatedTokens, estimatedDuration, maxRetries)", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: legacy-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: You are a legacy agent.
  outputs:
    - type: result
  resources:
    estimatedTokens: 15000
    estimatedDuration: 60s
    maxRetries: 2
`;
			// Old fields are silently stripped by Zod — must not throw
			const result = parseAgentDefinition(yaml);
			expect(result.metadata.name).toBe("legacy-agent");
			// Old fields not present in the parsed result
			const resources = result.spec.resources as Record<string, unknown>;
			expect(resources?.estimatedTokens).toBeUndefined();
			expect(resources?.estimatedDuration).toBeUndefined();
			expect(resources?.maxRetries).toBeUndefined();
		});

		it("accepts resources.timeoutSeconds (P42 per-agent override)", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: slow-agent
  phase: "4"
spec:
  executor: pi-coding-agent
  systemPrompt:
    text: You are a slow coding agent.
  outputs:
    - type: code
  resources:
    budget:
      maxTotalTokens: 150000
    timeoutSeconds: 1200
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources?.timeoutSeconds).toBe(1200);
		});

		it("accepts resources.timeoutSeconds: 0 (disable per agent)", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: no-timeout-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: You are an agent without timeouts.
  outputs:
    - type: result
  resources:
    timeoutSeconds: 0
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources?.timeoutSeconds).toBe(0);
		});

		it("rejects negative resources.timeoutSeconds", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: bad-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: You are an agent.
  outputs:
    - type: result
  resources:
    timeoutSeconds: -5
`;
			expect(() => parseAgentDefinition(yaml)).toThrow();
		});

		it("accepts YAML with resources block omitted entirely", () => {
			const yaml = `
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: no-resources-agent
  phase: "1"
spec:
  executor: pi-ai
  systemPrompt:
    text: You are a minimal agent.
  outputs:
    - type: result
`;
			const result = parseAgentDefinition(yaml);
			expect(result.spec.resources).toBeUndefined();
		});
	});
});
