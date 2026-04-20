import { statSync } from "node:fs";
import {
	loadDefinitionsFromDir,
	parseDefinitionFile,
} from "agentforge-core/definitions/parser.js";
import type { DefinitionStore } from "agentforge-core/definitions/store.js";
import type { Command } from "commander";

export function registerApplyCommand(
	program: Command,
	store: DefinitionStore,
): void {
	program
		.command("apply")
		.description("Load YAML definitions (agent, pipeline, node)")
		.requiredOption("-f, --file <path>", "Path to YAML file or directory")
		.action((options: { file: string }) => {
			const path = options.file;
			const stat = statSync(path);

			if (stat.isDirectory()) {
				const loaded = loadDefinitionsFromDir(path);
				for (const agent of loaded.agents) {
					store.addAgent(agent);
				}
				for (const pipeline of loaded.pipelines) {
					store.addPipeline(pipeline);
				}
				for (const node of loaded.nodes) {
					store.addNode(node);
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
						break;
					case "PipelineDefinition":
						store.addPipeline(def);
						break;
					case "NodeDefinition":
						store.addNode(def);
						break;
				}
				console.log(`Applied ${def.kind}: ${def.metadata.name}`);
			}
		});
}
