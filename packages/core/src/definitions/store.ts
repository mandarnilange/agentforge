import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "./parser.js";

export interface DefinitionStore {
	addAgent(agent: AgentDefinitionYaml): void;
	getAgent(name: string): AgentDefinitionYaml | undefined;
	listAgents(): AgentDefinitionYaml[];

	addPipeline(pipeline: PipelineDefinitionYaml): void;
	getPipeline(name: string): PipelineDefinitionYaml | undefined;
	listPipelines(): PipelineDefinitionYaml[];

	addNode(node: NodeDefinitionYaml): void;
	getNode(name: string): NodeDefinitionYaml | undefined;
	listNodes(): NodeDefinitionYaml[];

	clear(): void;
}

export function createDefinitionStore(): DefinitionStore {
	const agents = new Map<string, AgentDefinitionYaml>();
	const pipelines = new Map<string, PipelineDefinitionYaml>();
	const nodes = new Map<string, NodeDefinitionYaml>();

	return {
		addAgent(agent) {
			agents.set(agent.metadata.name, agent);
		},
		getAgent(name) {
			return agents.get(name);
		},
		listAgents() {
			return [...agents.values()];
		},

		addPipeline(pipeline) {
			pipelines.set(pipeline.metadata.name, pipeline);
		},
		getPipeline(name) {
			return pipelines.get(name);
		},
		listPipelines() {
			return [...pipelines.values()];
		},

		addNode(node) {
			nodes.set(node.metadata.name, node);
		},
		getNode(name) {
			return nodes.get(name);
		},
		listNodes() {
			return [...nodes.values()];
		},

		clear() {
			agents.clear();
			pipelines.clear();
			nodes.clear();
		},
	};
}
