import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldAgentforge } from "../../src/cli/commands/init.js";
import {
	getCoreTemplates,
	getTemplatePath,
} from "../../src/templates/registry.js";

const tmpDir = join(
	tmpdir(),
	`agentforge-templates-test-${randomBytes(4).toString("hex")}`,
);

beforeEach(() => {
	mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("template registry", () => {
	it("lists blank and simple-sdlc templates", () => {
		const templates = getCoreTemplates();
		const names = templates.map((t) => t.name);
		expect(names).toContain("blank");
		expect(names).toContain("simple-sdlc");
	});

	it("simple-sdlc has required manifest fields", () => {
		const templates = getCoreTemplates();
		const sdlc = templates.find((t) => t.name === "simple-sdlc");
		expect(sdlc).toBeDefined();
		expect(sdlc?.displayName).toBeTruthy();
		expect(sdlc?.description).toBeTruthy();
		expect(sdlc?.tags.length).toBeGreaterThan(0);
		expect(sdlc?.agents).toBeGreaterThan(0);
	});

	it("getTemplatePath returns path for simple-sdlc", () => {
		const path = getTemplatePath("simple-sdlc");
		expect(path).toBeTruthy();
		expect(existsSync(path ?? "")).toBe(true);
	});

	it("getTemplatePath returns null for unknown template", () => {
		expect(getTemplatePath("nonexistent")).toBeNull();
	});
});

describe("agentforge init --template simple-sdlc", () => {
	it("creates 3 agent files", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		for (const name of ["analyst", "architect", "developer"]) {
			expect(
				existsSync(join(tmpDir, ".agentforge", "agents", `${name}.agent.yaml`)),
			).toBe(true);
		}
	});

	it("creates simple-sdlc pipeline with wiring and gate", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		const pipelineFile = join(
			tmpDir,
			".agentforge",
			"pipelines",
			"simple-sdlc.pipeline.yaml",
		);
		expect(existsSync(pipelineFile)).toBe(true);
		const content = readFileSync(pipelineFile, "utf-8");
		expect(content).toContain("kind: PipelineDefinition");
		expect(content).toContain("wiring:");
		expect(content).toContain("gate:");
	});

	it("creates schemas for all agent outputs", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		for (const schema of [
			"requirements.schema.yaml",
			"architecture-plan.schema.yaml",
			"code-output.schema.yaml",
		]) {
			expect(existsSync(join(tmpDir, ".agentforge", "schemas", schema))).toBe(
				true,
			);
		}
	});

	it("creates system prompts for all agents", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		for (const name of ["analyst", "architect", "developer"]) {
			expect(
				existsSync(join(tmpDir, ".agentforge", "prompts", `${name}.system.md`)),
			).toBe(true);
		}
	});

	it("creates node configs", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		expect(
			existsSync(join(tmpDir, ".agentforge", "nodes", "local.node.yaml")),
		).toBe(true);
		expect(
			existsSync(join(tmpDir, ".agentforge", "nodes", "docker.node.yaml")),
		).toBe(true);
	});

	it("creates README.md", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		const readme = join(tmpDir, ".agentforge", "README.md");
		expect(existsSync(readme)).toBe(true);
		const content = readFileSync(readme, "utf-8");
		expect(content).toContain("simple-sdlc");
	});

	it("developer agent has loop in flow", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		const devAgent = readFileSync(
			join(tmpDir, ".agentforge", "agents", "developer.agent.yaml"),
			"utf-8",
		);
		expect(devAgent).toContain("loop:");
		expect(devAgent).toContain("maxIterations:");
	});

	it("developer agent has script definitions", () => {
		scaffoldAgentforge(tmpDir, "simple-sdlc");
		const devAgent = readFileSync(
			join(tmpDir, ".agentforge", "agents", "developer.agent.yaml"),
			"utf-8",
		);
		expect(devAgent).toContain("type: script");
		expect(devAgent).toContain("type: llm");
	});
});
