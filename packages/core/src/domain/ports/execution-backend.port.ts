/**
 * IExecutionBackend — the key abstraction for running agents against LLMs.
 * ZERO external dependencies.
 */

import type { ArtifactData } from "../models/artifact.model.js";
import type { AgentEvent } from "../models/events.model.js";

/** Per-agent token and cost limits. Either or both can be set. */
export interface Budget {
	/** Maximum cumulative token count (input + output). */
	readonly maxTotalTokens?: number;
	/** Maximum cumulative cost in USD. */
	readonly maxCostUsd?: number;
}

export interface AgentRunRequest {
	readonly agentId: string;
	readonly systemPrompt: string;
	readonly inputArtifacts: readonly ArtifactData[];
	readonly model: {
		readonly provider: string;
		readonly name: string;
		readonly maxTokens: number;
	};
	readonly tools?: readonly string[];
	/** Extension paths relative to the agentforge directory (.agentforge/). */
	readonly extensions?: readonly string[];
	readonly signal?: AbortSignal;
	/** Optional per-agent token/cost budget. Backend aborts when exceeded. */
	readonly budget?: Budget;
}

export interface ConversationEntry {
	readonly role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
	readonly content: string;
	/** Tool name, for tool_call and tool_result entries */
	readonly name?: string;
	readonly timestamp?: number;
}

/**
 * A named, provider-specific extra token bucket that isn't plain input/output.
 * Each adapter decides what to expose: Anthropic reports cache reads/writes;
 * OpenAI reports reasoning tokens; Gemini reports thinking tokens. Keeping
 * this list extensible means core stays provider-agnostic and the cost
 * calculator can price any new bucket without schema changes.
 *
 * `costMultiplier` is relative to the model's standard input price. For
 * Anthropic ephemeral cache: cache read = 0.1, cache write (5m TTL) = 1.25,
 * cache write (1h TTL) = 2.0. Adapters set this based on the billing rules
 * they know about.
 */
export interface TokenUsageExtra {
	/** Namespaced identifier, e.g. "anthropic.cacheRead", "openai.reasoning". */
	readonly kind: string;
	readonly tokens: number;
	/** Billing rate relative to the model's input price (1.0 = same as input). */
	readonly costMultiplier: number;
}

/**
 * Generic token usage produced by any execution backend. Adapters populate
 * `inputTokens` and `outputTokens` directly, plus an optional `extras` list
 * for provider-specific buckets. The cost calculator sums all of them.
 */
export interface TokenUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly extras?: readonly TokenUsageExtra[];
}

export interface AgentRunResult {
	readonly artifacts: readonly ArtifactData[];
	readonly tokenUsage: TokenUsage;
	readonly durationMs: number;
	readonly events: readonly AgentEvent[];
	readonly conversationLog?: readonly ConversationEntry[];
}

export interface IExecutionBackend {
	runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
}
