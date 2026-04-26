/**
 * NodeHealthMonitor — monitors node heartbeats and manages lifecycle transitions.
 *
 * Node status state machine:
 *   unknown → online (register) → degraded (late heartbeat) → offline (missed heartbeat)
 *
 * When a node goes offline:
 *   1. Stop scheduling new work
 *   2. Mark running agent runs on that node as failed
 *   3. Emit node_offline event
 */

import type { NodeStatus } from "@mandarnilange/agentforge-core/domain/models/node.model.js";
import type { IEventBus } from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";

export interface NodeHealthOptions {
	degradedThresholdMs: number; // default: 30_000
	offlineThresholdMs: number; // default: 120_000
}

export class NodeHealthMonitor {
	private intervalHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly store: IStateStore,
		private readonly eventBus: IEventBus,
		private readonly options: NodeHealthOptions,
	) {}

	start(intervalMs = 15_000): void {
		this.intervalHandle = setInterval(() => {
			void this.checkHealth();
		}, intervalMs);
	}

	stop(): void {
		if (this.intervalHandle) {
			clearInterval(this.intervalHandle);
			this.intervalHandle = null;
		}
	}

	async checkHealth(): Promise<void> {
		const nodes = await this.store.listNodes();
		const now = Date.now();

		for (const node of nodes) {
			const heartbeatAge = node.lastHeartbeat
				? now - new Date(node.lastHeartbeat).getTime()
				: Number.POSITIVE_INFINITY;

			const newStatus = this.computeStatus(heartbeatAge);

			if (newStatus !== node.status) {
				await this.store.upsertNode({
					...node,
					status: newStatus,
					updatedAt: new Date().toISOString(),
				});

				this.emitStatusEvent(node.name, newStatus);

				if (newStatus === "offline") {
					await this.failRunsOnNode(node.name);
				}
			}
		}
	}

	private computeStatus(heartbeatAgeMs: number): NodeStatus {
		if (heartbeatAgeMs > this.options.offlineThresholdMs) return "offline";
		if (heartbeatAgeMs > this.options.degradedThresholdMs) return "degraded";
		return "online";
	}

	private emitStatusEvent(nodeName: string, status: NodeStatus): void {
		switch (status) {
			case "online":
				this.eventBus.emit({ type: "node_online", nodeName });
				break;
			case "degraded":
				this.eventBus.emit({ type: "node_degraded", nodeName });
				break;
			case "offline":
				this.eventBus.emit({ type: "node_offline", nodeName });
				break;
		}
	}

	private async failRunsOnNode(nodeName: string): Promise<void> {
		const pipelines = await this.store.listPipelineRuns();
		for (const pipeline of pipelines) {
			if (pipeline.status !== "running") continue;

			const runs = await this.store.listAgentRuns(pipeline.id);
			for (const run of runs) {
				if (run.nodeName === nodeName && run.status === "running") {
					await this.store.updateAgentRun(run.id, {
						status: "failed",
						error: `node offline: ${nodeName}`,
						completedAt: new Date().toISOString(),
					});

					this.eventBus.emit({
						type: "run_updated",
						runId: run.id,
						status: "failed",
					});
				}
			}
		}
	}
}
