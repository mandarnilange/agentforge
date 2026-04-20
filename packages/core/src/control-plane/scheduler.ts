/**
 * LocalAgentScheduler — schedules agents to local nodes.
 * Respects nodeAffinity requirements and maxConcurrentRuns limits.
 * Future phases will add remote node scheduling.
 */

import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
} from "../definitions/parser.js";

export interface INodeRegistry {
	get(name: string): { status: string } | undefined;
	recordRunStarted(nodeName: string): void;
	recordRunCompleted(nodeName: string): void;
}

export interface IAgentScheduler {
	schedule(
		agent: AgentDefinitionYaml,
		nodePool: NodeDefinitionYaml[],
	): NodeDefinitionYaml;
	recordRunStarted(nodeName: string): void;
	recordRunCompleted(nodeName: string): void;
	getActiveRunCount(nodeName: string): number;
}

export class LocalAgentScheduler implements IAgentScheduler {
	private readonly activeRuns = new Map<string, number>();
	private readonly registry?: INodeRegistry;

	constructor(registry?: INodeRegistry) {
		this.registry = registry;
	}

	schedule(
		agent: AgentDefinitionYaml,
		nodePool: NodeDefinitionYaml[],
	): NodeDefinitionYaml {
		const required =
			agent.spec.nodeAffinity?.required?.map((r) => r.capability) ?? [];
		const preferred =
			agent.spec.nodeAffinity?.preferred?.map((p) => p.capability) ?? [];

		const candidates = nodePool.filter((node) => {
			const caps = node.spec.capabilities;
			const maxRuns = node.spec.resources?.maxConcurrentRuns ?? Infinity;
			const active = this.getActiveRunCount(node.metadata.name);
			const registration = this.registry?.get(node.metadata.name);
			const isOffline = registration?.status === "offline";
			return (
				required.every((cap) => caps.includes(cap)) &&
				active < maxRuns &&
				!isOffline
			);
		});

		if (candidates.length === 0) {
			throw new Error(
				`No available node satisfies requirements [${required.join(", ")}] for agent "${agent.metadata.name}"`,
			);
		}

		// Score: count how many preferred capabilities a node has
		const scored = candidates.map((node) => ({
			node,
			score: preferred.filter((cap) => node.spec.capabilities.includes(cap))
				.length,
		}));

		scored.sort((a, b) => b.score - a.score);
		const selected = scored[0].node;

		return selected;
	}

	recordRunStarted(nodeName: string): void {
		this.activeRuns.set(nodeName, (this.activeRuns.get(nodeName) ?? 0) + 1);
		this.registry?.recordRunStarted(nodeName);
	}

	recordRunCompleted(nodeName: string): void {
		const current = this.activeRuns.get(nodeName) ?? 0;
		this.activeRuns.set(nodeName, Math.max(0, current - 1));
		this.registry?.recordRunCompleted(nodeName);
	}

	getActiveRunCount(nodeName: string): number {
		return this.activeRuns.get(nodeName) ?? 0;
	}
}
