import type { NodeStatus } from "@mandarnilange/agentforge-core/domain/models/node.model.js";
import type { INodeRuntime } from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";
import type { AgentMetrics } from "@mandarnilange/agentforge-core/observability/metrics.js";
import type { NodeRegistry } from "./registry.js";

export class NodeHealthChecker {
	private readonly registry: NodeRegistry;
	private readonly runtimes: INodeRuntime[];
	private readonly metrics?: AgentMetrics;

	constructor(
		registry: NodeRegistry,
		runtimes: INodeRuntime[],
		metrics?: AgentMetrics,
	) {
		this.registry = registry;
		this.runtimes = runtimes;
		this.metrics = metrics;
	}

	async checkAll(): Promise<void> {
		await Promise.all(
			this.runtimes.map((r) => this.checkOne(r.nodeDefinition.metadata.name)),
		);
	}

	async checkOne(nodeName: string): Promise<NodeStatus> {
		const runtime = this.runtimes.find(
			(r) => r.nodeDefinition.metadata.name === nodeName,
		);
		if (!runtime) return "offline";

		const reachable = await runtime.ping();
		if (reachable) {
			this.registry.markOnline(nodeName);
			this.metrics?.recordNodeHeartbeat(nodeName, "online");
			return "online";
		}
		this.registry.markOffline(nodeName);
		this.metrics?.recordNodeHeartbeat(nodeName, "offline");
		return "offline";
	}

	startInterval(intervalMs: number): () => void {
		const handle = setInterval(() => {
			this.checkAll().catch(() => {});
		}, intervalMs);
		return () => clearInterval(handle);
	}
}
