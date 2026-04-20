import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "../domain/ports/agent-executor.port.js";
import { endSpan, startStepSpan } from "./spans.js";

/**
 * Tracing decorator for IAgentExecutor.
 * Wraps every execute() call with an OTel span that records:
 * - Agent ID, provider/model as attributes
 * - System prompt and user input as attributes
 * - Token usage and cost on success
 * - Conversation log as span events
 * - Error details on failure
 *
 * The inner executor stays pure — no OTel imports needed.
 */
export class TracedAgentExecutor implements IAgentExecutor {
	constructor(private readonly inner: IAgentExecutor) {}

	async execute(
		job: AgentJob,
		onStatus?: (update: StatusUpdate) => void,
	): Promise<AgentJobResult> {
		const span = startStepSpan({
			stepName: `agent.step executor ${job.agentId} ${job.model.provider}/${job.model.name}`,
			stepType: "executor",
		});
		span.setAttribute("agent.id", job.agentId);
		span.setAttribute("llm.provider", job.model.provider);
		span.setAttribute("llm.model", job.model.name);
		span.setAttribute("agent.run_id", job.runId);

		try {
			const result = await this.inner.execute(job, onStatus);

			span.setAttribute("llm.tokens.input", result.tokenUsage.inputTokens);
			span.setAttribute("llm.tokens.output", result.tokenUsage.outputTokens);
			span.setAttribute("agent.cost_usd", result.costUsd);
			span.setAttribute("agent.artifacts_count", result.artifacts.length);

			if (result.status === "failed") {
				endSpan(span, "error", result.error ?? "Unknown executor error");
			} else {
				endSpan(span, "ok");
			}

			return result;
		} catch (err) {
			endSpan(span, "error", err instanceof Error ? err.message : String(err));
			throw err;
		}
	}

	async cancel(runId: string): Promise<void> {
		await this.inner.cancel(runId);
	}
}
