import type {
	AgentRunRequest,
	AgentRunResult,
	IExecutionBackend,
} from "../domain/ports/execution-backend.port.js";
import { endSpan, startStepSpan } from "./spans.js";

/**
 * Tracing decorator for IExecutionBackend.
 * Wraps every runAgent() call with an OTel span that records:
 * - LLM provider/model as attributes
 * - System prompt and user input as attributes
 * - Token usage on success
 * - Error details on failure
 *
 * The inner backend stays pure — no OTel imports needed.
 */
export class TracedExecutionBackend implements IExecutionBackend {
	constructor(private readonly inner: IExecutionBackend) {}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const span = startStepSpan({
			stepName: `agent.step llm.call ${request.model.provider}/${request.model.name}`,
			stepType: "llm",
		});
		span.setAttribute("llm.provider", request.model.provider);
		span.setAttribute("llm.model", request.model.name);
		span.setAttribute("llm.system_prompt", request.systemPrompt.slice(0, 4096));
		span.setAttribute(
			"llm.user_message",
			request.inputArtifacts
				.map((a) => `[${a.path}] ${a.content.slice(0, 1000)}`)
				.join("\n")
				.slice(0, 4096),
		);

		try {
			const result = await this.inner.runAgent(request);

			span.setAttribute("llm.tokens.input", result.tokenUsage.inputTokens);
			span.setAttribute("llm.tokens.output", result.tokenUsage.outputTokens);

			// Check if the result contains an error event (backends return errors as events, not exceptions)
			const errorEvent = result.events.find((e) => e.kind === "error");
			if (errorEvent) {
				endSpan(span, "error", errorEvent.message);
			} else {
				endSpan(span, "ok");
			}

			return result;
		} catch (err) {
			endSpan(span, "error", err instanceof Error ? err.message : String(err));
			throw err;
		}
	}
}
