import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import * as attrs from "./attributes.js";

const DEFAULT_TRACER = "sdlc-agent";

function getTracer() {
	return trace.getTracer(DEFAULT_TRACER);
}

export interface PipelineSpanOptions {
	pipelineId: string;
	pipelineName: string;
	projectName?: string;
}

export interface AgentRunSpanOptions {
	agentName: string;
	runId: string;
	phase: string;
	executor: string;
}

export interface StepSpanOptions {
	stepName: string;
	stepType: string;
}

export function startPipelineSpan(
	options: PipelineSpanOptions,
	parent?: Span,
): Span {
	const tracer = getTracer();
	const ctx = parent
		? trace.setSpan(context.active(), parent)
		: context.active();

	const spanName = `pipeline.run ${options.pipelineName}${options.projectName ? ` (${options.projectName})` : ""}`;
	const span = tracer.startSpan(spanName, {}, ctx);
	span.setAttribute(attrs.AGENTFORGE_PIPELINE_ID, options.pipelineId);
	span.setAttribute(attrs.AGENTFORGE_PIPELINE_NAME, options.pipelineName);
	if (options.projectName) {
		span.setAttribute(attrs.AGENTFORGE_PROJECT_NAME, options.projectName);
	}
	return span;
}

export function startAgentRunSpan(
	options: AgentRunSpanOptions,
	parent?: Span,
): Span {
	const tracer = getTracer();
	const ctx = parent
		? trace.setSpan(context.active(), parent)
		: context.active();

	const spanName = `agent.run ${options.agentName} (phase ${options.phase})`;
	const span = tracer.startSpan(spanName, {}, ctx);
	span.setAttribute(attrs.AGENTFORGE_AGENT_NAME, options.agentName);
	span.setAttribute(attrs.AGENTFORGE_AGENT_RUN_ID, options.runId);
	span.setAttribute(attrs.AGENTFORGE_PHASE, options.phase);
	span.setAttribute(attrs.AGENTFORGE_AGENT_EXECUTOR, options.executor);
	return span;
}

export function startStepSpan(options: StepSpanOptions, parent?: Span): Span {
	const tracer = getTracer();
	const ctx = parent
		? trace.setSpan(context.active(), parent)
		: context.active();

	const span = tracer.startSpan(options.stepName, {}, ctx);
	span.setAttribute(attrs.AGENTFORGE_STEP_NAME, options.stepName);
	span.setAttribute(attrs.AGENTFORGE_STEP_TYPE, options.stepType);
	return span;
}

const MAX_EVENT_CONTENT_LENGTH = 4096;

export interface ConversationMessage {
	role: "user" | "assistant" | "tool_call" | "tool_result";
	content: string;
	name?: string;
	timestamp?: number;
}

export function recordConversationEvents(
	span: Span,
	messages: ConversationMessage[],
): void {
	for (const msg of messages) {
		const content =
			msg.content.length > MAX_EVENT_CONTENT_LENGTH
				? `${msg.content.slice(0, MAX_EVENT_CONTENT_LENGTH)}…`
				: msg.content;

		span.addEvent("conversation.message", {
			"conversation.role": msg.role,
			"conversation.content": content,
			...(msg.name ? { "conversation.tool_name": msg.name } : {}),
		});
	}
}

/**
 * Runs a function within the context of a span, so any child spans
 * created inside (even by third-party libraries) auto-nest under it.
 */
export async function withSpanContext<T>(
	span: Span,
	fn: () => Promise<T>,
): Promise<T> {
	const ctx = trace.setSpan(context.active(), span);
	return context.with(ctx, fn);
}

export function endSpan(
	span: Span,
	status: "ok" | "error",
	message?: string,
): void {
	if (status === "error") {
		span.setStatus({ code: SpanStatusCode.ERROR, message });
	} else {
		span.setStatus({ code: SpanStatusCode.OK });
	}
	span.end();
}
