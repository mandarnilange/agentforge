import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
	SchemaResource,
} from "@mandarnilange/agentforge-core/definitions/parser.js";
import {
	loadDefinitionsFromDir,
	parseDefinitionFile,
} from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { DefinitionStore } from "@mandarnilange/agentforge-core/definitions/store.js";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";

/**
 * Optional async write-through sink. apply writes to the runtime sync
 * `store` for in-process visibility AND awaits the sink so the
 * persistence layer (Postgres in PG mode, SQLite definition store
 * otherwise) has the change committed + a history row written before
 * the command returns.
 */
export interface DefinitionPersistSink {
	upsertAgent(agent: AgentDefinitionYaml, changedBy: string): Promise<void>;
	upsertPipeline(
		pipeline: PipelineDefinitionYaml,
		changedBy: string,
	): Promise<void>;
	upsertNode(node: NodeDefinitionYaml, changedBy: string): Promise<void>;
	upsertSchema(schema: SchemaResource, changedBy: string): Promise<void>;
}

/**
 * If the agent's systemPrompt is a `file:` reference, resolve it against
 * the apply'd directory and inline the content into `text:` BEFORE
 * persisting. The DB-stored agent yaml is then self-contained — runtime
 * doesn't need to find the prompt file on disk later (which it would
 * not, in PG/multi-host deployments).
 *
 * Tries candidates in order: file path as given, then under
 * `<templateRoot>/prompts/<file>`. If neither exists, throws so apply
 * exits non-zero — silently persisting an agent with an unresolvable
 * prompt would just produce a runtime-time failure later, harder to
 * diagnose. Future: a `Prompt` resource kind so prompts can be applied
 * + referenced by name (see ROADMAP).
 */
function inlinePromptIfFile(
	agent: AgentDefinitionYaml,
	templateRoot: string,
): AgentDefinitionYaml {
	const promptFile = agent.spec.systemPrompt?.file;
	if (!promptFile || agent.spec.systemPrompt.text) return agent;

	const candidates: string[] = [];
	if (isAbsolute(promptFile)) {
		candidates.push(promptFile);
	} else {
		candidates.push(resolvePath(templateRoot, promptFile));
		candidates.push(resolvePath(templateRoot, "prompts", promptFile));
	}
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			const text = readFileSync(candidate, "utf-8");
			return {
				...agent,
				spec: { ...agent.spec, systemPrompt: { text } },
			};
		}
	}
	throw new Error(
		`apply: prompt file '${promptFile}' for agent '${agent.metadata.name}' was not found. ` +
			`Looked under:\n` +
			candidates.map((c) => `  ${c}`).join("\n") +
			`\nFix: either ship the prompt file alongside the agent yaml ` +
			`(typically under \`prompts/${promptFile}\`), or replace ` +
			`\`systemPrompt.file\` with inline \`systemPrompt.text\` in the agent yaml.`,
	);
}

function readSingleSchema(path: string): SchemaResource | null {
	if (!path.endsWith(".schema.yaml") && !path.endsWith(".schema.json")) {
		return null;
	}
	const raw = readFileSync(path, "utf-8");
	const parsed = path.endsWith(".schema.json")
		? JSON.parse(raw)
		: parseYaml(raw);
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed as Record<string, unknown>;
	if ("kind" in obj && "apiVersion" in obj) return null;
	const suffix = path.endsWith(".schema.json")
		? ".schema.json"
		: ".schema.yaml";
	const fileName = path.split("/").pop() ?? path;
	const name = fileName.slice(0, -suffix.length);
	return { name, source: path, schema: obj };
}

export function registerApplyCommand(
	program: Command,
	store: DefinitionStore,
	persistSink?: DefinitionPersistSink | null,
): void {
	program
		.command("apply")
		.description(
			"Load YAML resources (agent, pipeline, node, schema) from a file or directory",
		)
		.requiredOption("-f, --file <path>", "Path to YAML file or directory")
		.action(async (options: { file: string }) => {
			const path = options.file;
			const stat = statSync(path);

			if (stat.isDirectory()) {
				const loaded = loadDefinitionsFromDir(path);
				for (const rawAgent of loaded.agents) {
					const agent = inlinePromptIfFile(rawAgent, path);
					store.addAgent(agent);
					await persistSink?.upsertAgent(agent, "apply");
				}
				for (const pipeline of loaded.pipelines) {
					store.addPipeline(pipeline);
					await persistSink?.upsertPipeline(pipeline, "apply");
				}
				for (const node of loaded.nodes) {
					store.addNode(node);
					await persistSink?.upsertNode(node, "apply");
				}
				for (const schema of loaded.schemas) {
					await persistSink?.upsertSchema(schema, "apply");
				}

				const counts = [
					`${loaded.agents.length} agent(s)`,
					`${loaded.pipelines.length} pipeline(s)`,
					`${loaded.nodes.length} node(s)`,
					`${loaded.schemas.length} schema(s)`,
				];
				const total =
					loaded.agents.length +
					loaded.pipelines.length +
					loaded.nodes.length +
					loaded.schemas.length;
				console.log(`Applied ${total} resource(s): ${counts.join(", ")}`);
				if (loaded.schemas.length > 0 && !persistSink) {
					console.warn(
						`Note: ${loaded.schemas.length} schema(s) detected but not persisted (no persist sink). ` +
							"In SQLite mode, schemas live in `.agentforge/schemas/` and are filesystem-discovered at boot.",
					);
				}
				return;
			}

			// Single-file path: schema or definition.
			const schema = readSingleSchema(path);
			if (schema) {
				if (persistSink) {
					await persistSink.upsertSchema(schema, "apply");
					console.log(`Applied Schema: ${schema.name}`);
				} else {
					console.warn(
						`Schema detected at ${path}, but no persist sink is configured. ` +
							"Drop the file in `.agentforge/schemas/` for filesystem discovery.",
					);
				}
				return;
			}

			const def = parseDefinitionFile(path);
			switch (def.kind) {
				case "AgentDefinition": {
					const inlined = inlinePromptIfFile(def, dirname(path));
					store.addAgent(inlined);
					await persistSink?.upsertAgent(inlined, "apply");
					break;
				}
				case "PipelineDefinition":
					store.addPipeline(def);
					await persistSink?.upsertPipeline(def, "apply");
					break;
				case "NodeDefinition":
					store.addNode(def);
					await persistSink?.upsertNode(def, "apply");
					break;
			}
			console.log(`Applied ${def.kind}: ${def.metadata.name}`);
		});
}
