import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { getTemplatePath } from "../../templates/registry.js";

export interface ScaffoldOptions {
	force?: boolean;
}

const SUBDIRS = [
	"agents",
	"pipelines",
	"schemas",
	"prompts",
	"nodes",
	"extensions",
];

const BLANK_AGENT = `apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: example
  displayName: Example Agent
  description: A starter agent — customize this for your workflow
  phase: "1"
  role: analyst
  humanEquivalent: Business Analyst

spec:
  executor: pi-ai

  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384
    thinking: medium

  systemPrompt:
    file: prompts/example.system.md

  inputs:
    - type: raw-brief
      required: true

  outputs:
    - type: analysis
      schema: schemas/analysis.schema.yaml

  resources:
    budget:
      maxTotalTokens: 50000
      maxCostUsd: 0.15
`;

const BLANK_PIPELINE = `apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: example
  displayName: Example Pipeline
  description: A single-agent starter pipeline

spec:
  input:
    - name: brief
      type: raw-brief
      description: Project brief or requirements
      required: true

  phases:
    - name: analysis
      phase: 1
      agents:
        - example
      gate:
        required: true
        approvers:
          minCount: 1
          roles: [admin, reviewer]

  gateDefaults:
    actions:
      - approve
      - reject
      - request-revision
    timeout: 72h
`;

const BLANK_PROMPT = `You are Example Agent, a Business Analyst agent in an AgentForge pipeline.

## Your Role
Analyze the provided brief and produce a structured analysis document.

## Input
You receive a raw project brief from the user.

## Output
Produce a JSON artifact of type "analysis" with your findings.
`;

const BLANK_SCHEMA = `$schema: "https://json-schema.org/draft/2020-12/schema"
title: Analysis
description: Example analysis artifact
type: object
required:
  - summary
  - findings
properties:
  summary:
    type: string
    description: Executive summary of the analysis
  findings:
    type: array
    items:
      type: object
      required:
        - title
        - description
      properties:
        title:
          type: string
        description:
          type: string
        severity:
          type: string
          enum: [low, medium, high, critical]
`;

export function scaffoldAgentforge(
	targetDir: string,
	template: string,
	options: ScaffoldOptions = {},
	platformResolver?: (name: string) => string | null,
): void {
	const agentforgeDir = join(targetDir, ".agentforge");

	if (existsSync(agentforgeDir) && !options.force) {
		throw new Error(
			`.agentforge directory already exists at ${agentforgeDir}. Use --force to overwrite.`,
		);
	}

	for (const sub of SUBDIRS) {
		mkdirSync(join(agentforgeDir, sub), { recursive: true });
	}

	const corePath = getTemplatePath(template);
	if (corePath) {
		scaffoldFromDirectory(corePath, agentforgeDir);
		return;
	}

	// Check platform registry if a resolver was provided
	const platformPath = platformResolver?.(template) ?? null;
	if (platformPath) {
		scaffoldFromDirectory(platformPath, agentforgeDir);
		return;
	}

	// Fall back to blank scaffold
	scaffoldBlank(agentforgeDir);
}

function scaffoldBlank(agentforgeDir: string): void {
	writeFileSync(
		join(agentforgeDir, "agents", "example.agent.yaml"),
		BLANK_AGENT,
	);
	writeFileSync(
		join(agentforgeDir, "pipelines", "example.pipeline.yaml"),
		BLANK_PIPELINE,
	);
	writeFileSync(
		join(agentforgeDir, "prompts", "example.system.md"),
		BLANK_PROMPT,
	);
	writeFileSync(
		join(agentforgeDir, "schemas", "analysis.schema.yaml"),
		BLANK_SCHEMA,
	);
}

/** Copy an entire bundled template directory tree into .agentforge/. */
function scaffoldFromDirectory(
	templateDir: string,
	agentforgeDir: string,
): void {
	const subdirs = readdirSync(templateDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name);

	for (const sub of subdirs) {
		copyDir(join(templateDir, sub), join(agentforgeDir, sub));
	}

	// Copy README.md if present
	const readmeSrc = join(templateDir, "README.md");
	if (existsSync(readmeSrc)) {
		copyFileSync(readmeSrc, join(agentforgeDir, "README.md"));
	}
}

function copyDir(src: string, dest: string): void {
	if (!existsSync(src)) return;
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src)) {
		copyFileSync(join(src, entry), join(dest, entry));
	}
}

export function registerInitCommand(
	program: Command,
	platformResolver?: (name: string) => string | null,
): void {
	program
		.command("init")
		.description(
			"Scaffold a .agentforge directory with agent and pipeline templates",
		)
		.option(
			"-t, --template <name>",
			"template to use (default: blank). Run the 'templates list' command to see all.",
			"blank",
		)
		.option("-f, --force", "overwrite existing .agentforge directory")
		.action((opts: { template: string; force?: boolean }) => {
			const cwd = process.cwd();
			scaffoldAgentforge(
				cwd,
				opts.template,
				{ force: opts.force },
				platformResolver,
			);
			console.log(
				`Scaffolded .agentforge/ with "${opts.template}" template. Next steps:`,
			);
			console.log("  1. Edit .agentforge/agents/ to define your agents");
			console.log("  2. Edit .agentforge/pipelines/ to wire your pipeline");
			console.log("  3. Run: agentforge list");
		});
}
