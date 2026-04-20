import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "./parser.js";
import type { DefinitionStore } from "./store.js";

interface StoredDefinitions {
	agents: AgentDefinitionYaml[];
	pipelines: PipelineDefinitionYaml[];
	nodes: NodeDefinitionYaml[];
}

function readDisk(filePath: string): StoredDefinitions {
	if (!existsSync(filePath)) {
		return { agents: [], pipelines: [], nodes: [] };
	}
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as StoredDefinitions;
	} catch {
		return { agents: [], pipelines: [], nodes: [] };
	}
}

function writeDisk(filePath: string, data: StoredDefinitions): void {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function createFileDefinitionStore(filePath: string): DefinitionStore {
	return {
		addAgent(agent) {
			const data = readDisk(filePath);
			const idx = data.agents.findIndex(
				(a) => a.metadata.name === agent.metadata.name,
			);
			if (idx >= 0) {
				data.agents[idx] = agent;
			} else {
				data.agents.push(agent);
			}
			writeDisk(filePath, data);
		},
		getAgent(name) {
			return readDisk(filePath).agents.find((a) => a.metadata.name === name);
		},
		listAgents() {
			return readDisk(filePath).agents;
		},

		addPipeline(pipeline) {
			const data = readDisk(filePath);
			const idx = data.pipelines.findIndex(
				(p) => p.metadata.name === pipeline.metadata.name,
			);
			if (idx >= 0) {
				data.pipelines[idx] = pipeline;
			} else {
				data.pipelines.push(pipeline);
			}
			writeDisk(filePath, data);
		},
		getPipeline(name) {
			return readDisk(filePath).pipelines.find((p) => p.metadata.name === name);
		},
		listPipelines() {
			return readDisk(filePath).pipelines;
		},

		addNode(node) {
			const data = readDisk(filePath);
			const idx = data.nodes.findIndex(
				(n) => n.metadata.name === node.metadata.name,
			);
			if (idx >= 0) {
				data.nodes[idx] = node;
			} else {
				data.nodes.push(node);
			}
			writeDisk(filePath, data);
		},
		getNode(name) {
			return readDisk(filePath).nodes.find((n) => n.metadata.name === name);
		},
		listNodes() {
			return readDisk(filePath).nodes;
		},

		clear() {
			writeDisk(filePath, { agents: [], pipelines: [], nodes: [] });
		},
	};
}
