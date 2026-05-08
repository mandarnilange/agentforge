/**
 * LocalAgentScheduler — schedules agents to nodes (P45-T6).
 *
 * Counts are read via an injected IActiveRunCounter so the scheduler is
 * stateless across control-plane replicas. The default in-memory counter
 * preserves single-process semantics; the platform supplies a DB-backed
 * counter that queries `agent_runs` so two replicas never disagree about
 * a node's load.
 */

import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
} from "../definitions/parser.js";
import type { IActiveRunCounter } from "../domain/ports/active-run-counter.port.js";

export interface INodeRegistry {
	get(name: string): { status: string } | undefined;
	recordRunStarted(nodeName: string): void;
	recordRunCompleted(nodeName: string): void;
}

export interface IAgentScheduler {
	schedule(
		agent: AgentDefinitionYaml,
		nodePool: NodeDefinitionYaml[],
	): Promise<NodeDefinitionYaml>;
	recordRunStarted(nodeName: string): void;
	recordRunCompleted(nodeName: string): void;
	getActiveRunCount(nodeName: string): Promise<number>;
}

export interface LocalSchedulerOptions {
	/**
	 * Counter for active runs. If omitted, an in-process counter backs the
	 * historical in-memory Map<string, number>. Multi-replica deployments
	 * inject a DB-backed counter so all replicas share one truth.
	 */
	counter?: IActiveRunCounter;
}

export class LocalAgentScheduler implements IAgentScheduler {
	private readonly registry?: INodeRegistry;
	private readonly counter: IActiveRunCounter;

	constructor(registry?: INodeRegistry, opts: LocalSchedulerOptions = {}) {
		this.registry = registry;
		this.counter = opts.counter ?? new InMemoryActiveRunCounter();
	}

	async schedule(
		agent: AgentDefinitionYaml,
		nodePool: NodeDefinitionYaml[],
	): Promise<NodeDefinitionYaml> {
		const required =
			agent.spec.nodeAffinity?.required?.map((r) => r.capability) ?? [];
		const preferred =
			agent.spec.nodeAffinity?.preferred?.map((p) => p.capability) ?? [];

		// Read every candidate's load from the counter — fresh on each call
		// so a peer replica's recent dispatch is reflected immediately.
		const counts = await Promise.all(
			nodePool.map((n) => this.counter.count(n.metadata.name)),
		);

		const candidates = nodePool.filter((node, i) => {
			const caps = node.spec.capabilities;
			const maxRuns = node.spec.resources?.maxConcurrentRuns ?? Infinity;
			const active = counts[i];
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
		return scored[0].node;
	}

	recordRunStarted(nodeName: string): void {
		void this.counter.recordStarted(nodeName);
		this.registry?.recordRunStarted(nodeName);
	}

	recordRunCompleted(nodeName: string): void {
		void this.counter.recordCompleted(nodeName);
		this.registry?.recordRunCompleted(nodeName);
	}

	getActiveRunCount(nodeName: string): Promise<number> {
		return this.counter.count(nodeName);
	}
}

/**
 * In-process counter — preserves the historical Map<string, number>
 * behaviour for callers that don't pass a counter explicitly. Not safe
 * across processes.
 */
export class InMemoryActiveRunCounter implements IActiveRunCounter {
	private readonly counts = new Map<string, number>();

	count(nodeName: string): Promise<number> {
		return Promise.resolve(this.counts.get(nodeName) ?? 0);
	}

	recordStarted(nodeName: string): Promise<void> {
		this.counts.set(nodeName, (this.counts.get(nodeName) ?? 0) + 1);
		return Promise.resolve();
	}

	recordCompleted(nodeName: string): Promise<void> {
		const current = this.counts.get(nodeName) ?? 0;
		this.counts.set(nodeName, Math.max(0, current - 1));
		return Promise.resolve();
	}
}
