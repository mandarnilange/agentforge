import { statSync } from "node:fs";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "agentforge-core/definitions/parser.js";
import {
	loadDefinitionsFromDir,
	parseDefinitionFile,
} from "agentforge-core/definitions/parser.js";
import type { DefinitionStore } from "agentforge-core/definitions/store.js";
import type { Command } from "commander";

/**
 * Optional async write-through sink. When configured (PG mode), apply
 * writes to the sync `store` for the runtime AND awaits the sink so the
 * Postgres persistence + history land before the command returns.
 */
export interface DefinitionPersistSink {
	upsertAgent(agent: AgentDefinitionYaml, changedBy: string): Promise<void>;
	upsertPipeline(
		pipeline: PipelineDefinitionYaml,
		changedBy: string,
	): Promise<void>;
	upsertNode(node: NodeDefinitionYaml, changedBy: string): Promise<void>;
}

export function registerApplyCommand(
	program: Command,
	store: DefinitionStore,
	persistSink?: DefinitionPersistSink | null,
): void {
	program
		.command("apply")
		.description("Load YAML definitions (agent, pipeline, node)")
		.requiredOption("-f, --file <path>", "Path to YAML file or directory")
		.action(async (options: { file: string }) => {
			const path = options.file;
			const stat = statSync(path);

			if (stat.isDirectory()) {
				const loaded = loadDefinitionsFromDir(path);
				for (const agent of loaded.agents) {
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

				const total =
					loaded.agents.length + loaded.pipelines.length + loaded.nodes.length;
				console.log(
					`Applied ${total} definition(s): ${loaded.agents.length} agent(s), ${loaded.pipelines.length} pipeline(s), ${loaded.nodes.length} node(s)`,
				);
			} else {
				const def = parseDefinitionFile(path);
				switch (def.kind) {
					case "AgentDefinition":
						store.addAgent(def);
						await persistSink?.upsertAgent(def, "apply");
						break;
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
			}
		});
}
