import type { IControlPlaneApi } from "agentforge-core/domain/ports/control-plane-api.port.js";
import type { INodeRuntime } from "agentforge-core/domain/ports/node-runtime.port.js";

export class NodeWorker {
	private activeRuns = 0;

	constructor(
		private readonly runtime: INodeRuntime,
		private readonly api: IControlPlaneApi,
	) {}

	async start(): Promise<void> {
		this.api.registerNode(this.runtime.nodeDefinition);
	}

	async pollOnce(): Promise<void> {
		const nodeName = this.runtime.nodeDefinition.metadata.name;
		const pending = this.api.getPendingRuns(nodeName);
		await Promise.all(
			pending.map(async (run) => {
				this.activeRuns += 1;
				try {
					const result = await this.runtime.execute(run);
					this.api.reportRunResult(run.runId, result);
				} finally {
					this.activeRuns = Math.max(0, this.activeRuns - 1);
				}
			}),
		);
	}

	async reportHeartbeat(): Promise<void> {
		const nodeName = this.runtime.nodeDefinition.metadata.name;
		this.api.reportHeartbeat(nodeName, this.activeRuns);
	}
}
