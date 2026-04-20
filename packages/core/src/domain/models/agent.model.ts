/**
 * Domain types for agent definitions and run statuses.
 * ZERO external dependencies.
 */

import type { ArtifactType } from "./artifact.model.js";

/** SDLC phase an agent belongs to. */
export type AgentPhase =
	| "design"
	| "implementation"
	| "testing"
	| "review"
	| "deployment"
	| "monitoring";

/** Static definition of an agent in the pipeline. */
export interface AgentDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly phase: AgentPhase;
	readonly inputArtifactTypes: readonly ArtifactType[];
	readonly outputArtifactTypes: readonly ArtifactType[];
	readonly tools?: readonly string[];
	readonly model?: {
		readonly provider: string;
		readonly name: string;
		readonly maxTokens: number;
	};
}

/** Runtime status of a single agent run. */
export interface AgentRunStatus {
	readonly agentId: string;
	readonly status: "pending" | "running" | "completed" | "failed" | "cancelled";
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly artifactsProduced?: number;
	readonly error?: string;
}
