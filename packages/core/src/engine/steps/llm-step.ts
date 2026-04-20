import type { ArtifactData } from "../../domain/models/artifact.model.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	ConversationEntry,
	IExecutionBackend,
	TokenUsage,
} from "../../domain/ports/execution-backend.port.js";
import type { StepResult } from "./script-step.js";

export interface LlmStepDef {
	name: string;
	type: "llm";
	/** Task instructions sent to the LLM for this step. */
	instructions?: string;
	/** @deprecated Use `instructions` instead. Kept for backward compatibility. */
	description?: string;
	continueOnError?: boolean;
	condition?: string;
	timeout?: number;
}

export interface LlmStepResult extends StepResult {
	artifacts: readonly ArtifactData[];
	tokenUsage?: TokenUsage;
	conversationLog?: readonly ConversationEntry[];
}

export async function executeLlmStep(
	step: LlmStepDef,
	backend: IExecutionBackend,
	request: AgentRunRequest,
): Promise<LlmStepResult> {
	const start = Date.now();

	try {
		const result: AgentRunResult = await backend.runAgent(request);

		// Check for error events — backends return errors as events, not exceptions
		const errorEvent = result.events.find((e) => e.kind === "error");
		if (errorEvent) {
			return {
				name: step.name,
				type: "llm",
				status: "failed",
				durationMs: Date.now() - start,
				error: errorEvent.message,
				artifacts: [],
			};
		}

		// Use the last assistant message as the step output so downstream
		// steps (e.g. quality-gate scripts) can reference {{steps.<name>.output}}.
		const lastAssistant = result.conversationLog
			?.filter((e) => e.role === "assistant")
			.pop();
		const output =
			lastAssistant?.content ??
			`Generated ${result.artifacts.length} artifact(s)`;

		return {
			name: step.name,
			type: "llm",
			status: "success",
			output,
			durationMs: Date.now() - start,
			artifacts: result.artifacts,
			tokenUsage: result.tokenUsage,
			conversationLog: result.conversationLog,
		};
	} catch (err) {
		return {
			name: step.name,
			type: "llm",
			status: "failed",
			durationMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
			artifacts: [],
		};
	}
}
