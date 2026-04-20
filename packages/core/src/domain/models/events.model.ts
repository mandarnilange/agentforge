/**
 * AgentEvent — discriminated union of all events emitted during an agent run.
 * ZERO external dependencies.
 */

import type { ArtifactData } from "./artifact.model.js";

export interface ThinkingEvent {
	readonly kind: "thinking";
	readonly timestamp: number;
	readonly content: string;
}

export interface ToolUseEvent {
	readonly kind: "tool_use";
	readonly timestamp: number;
	readonly toolName: string;
	readonly input: Record<string, unknown>;
}

export interface ToolResultEvent {
	readonly kind: "tool_result";
	readonly timestamp: number;
	readonly toolName: string;
	readonly output: string;
	readonly isError: boolean;
}

export interface ArtifactProducedEvent {
	readonly kind: "artifact_produced";
	readonly timestamp: number;
	readonly artifact: ArtifactData;
}

export interface ErrorEvent {
	readonly kind: "error";
	readonly timestamp: number;
	readonly message: string;
	readonly code?: string;
}

export interface StepStartedEvent {
	readonly kind: "step_started";
	readonly timestamp: number;
	readonly stepName: string;
}

export interface StepCompletedEvent {
	readonly kind: "step_completed";
	readonly timestamp: number;
	readonly stepName: string;
	readonly durationMs: number;
}

export interface BudgetExceededEvent {
	readonly kind: "budget_exceeded";
	readonly timestamp: number;
	/** Human-readable explanation of which limit was hit. */
	readonly reason: string;
	readonly totalTokens: number;
	readonly budgetTokens?: number;
	readonly costUsd?: number;
	readonly budgetCostUsd?: number;
}

/** Discriminated union of all agent events. */
export type AgentEvent =
	| ThinkingEvent
	| ToolUseEvent
	| ToolResultEvent
	| ArtifactProducedEvent
	| ErrorEvent
	| StepStartedEvent
	| StepCompletedEvent
	| BudgetExceededEvent;
