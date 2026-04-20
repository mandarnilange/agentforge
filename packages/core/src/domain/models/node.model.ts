/**
 * Domain model for execution nodes and their persisted health state.
 * ZERO external dependencies.
 */

export type NodeStatus = "online" | "offline" | "unknown" | "degraded";

export interface NodeRecord {
	readonly name: string;
	readonly type: string;
	readonly capabilities: string[];
	readonly maxConcurrentRuns?: number;
	readonly status: NodeStatus;
	readonly activeRuns: number;
	readonly lastHeartbeat?: string;
	readonly updatedAt: string;
}
