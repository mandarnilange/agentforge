import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldAgentforge } from "../../src/cli/commands/init.js";

const tmpDir = join(process.cwd(), "tmp-init-test");

beforeEach(() => {
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("agentforge init", () => {
	describe("blank template", () => {
		it("creates .agentforge directory structure", () => {
			scaffoldAgentforge(tmpDir, "blank");

			expect(existsSync(join(tmpDir, ".agentforge"))).toBe(true);
			expect(existsSync(join(tmpDir, ".agentforge", "agents"))).toBe(true);
			expect(existsSync(join(tmpDir, ".agentforge", "pipelines"))).toBe(true);
			expect(existsSync(join(tmpDir, ".agentforge", "schemas"))).toBe(true);
			expect(existsSync(join(tmpDir, ".agentforge", "prompts"))).toBe(true);
			expect(existsSync(join(tmpDir, ".agentforge", "extensions"))).toBe(true);
		});

		it("creates an example agent YAML", () => {
			scaffoldAgentforge(tmpDir, "blank");

			const agentFile = join(
				tmpDir,
				".agentforge",
				"agents",
				"example.agent.yaml",
			);
			expect(existsSync(agentFile)).toBe(true);

			const content = readFileSync(agentFile, "utf-8");
			expect(content).toContain("kind: AgentDefinition");
			expect(content).toContain("name: example");
			// Should NOT have 'from' in inputs (P37 decoupled format)
			expect(content).not.toContain("from:");
		});

		it("creates an example pipeline YAML with wiring", () => {
			scaffoldAgentforge(tmpDir, "blank");

			const pipelineFile = join(
				tmpDir,
				".agentforge",
				"pipelines",
				"example.pipeline.yaml",
			);
			expect(existsSync(pipelineFile)).toBe(true);

			const content = readFileSync(pipelineFile, "utf-8");
			expect(content).toContain("kind: PipelineDefinition");
		});

		it("creates an example system prompt", () => {
			scaffoldAgentforge(tmpDir, "blank");

			const promptFile = join(
				tmpDir,
				".agentforge",
				"prompts",
				"example.system.md",
			);
			expect(existsSync(promptFile)).toBe(true);
		});
	});

	describe("safety", () => {
		it("does not overwrite existing .agentforge directory", () => {
			const agentforgeDir = join(tmpDir, ".agentforge");
			mkdirSync(agentforgeDir, { recursive: true });

			expect(() => scaffoldAgentforge(tmpDir, "blank")).toThrow(
				/already exists/,
			);
		});

		it("overwrites when force is true", () => {
			const agentforgeDir = join(tmpDir, ".agentforge");
			mkdirSync(agentforgeDir, { recursive: true });

			scaffoldAgentforge(tmpDir, "blank", { force: true });
			expect(existsSync(join(tmpDir, ".agentforge", "agents"))).toBe(true);
		});
	});
});
