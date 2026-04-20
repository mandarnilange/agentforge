/**
 * PiCodingAgentExecutionBackend — IExecutionBackend using @mariozechner/pi-agent-core Agent.
 * Used by code-producing agents
 * that need file tools (read/write/edit/bash).
 *
 * OTel tracing for the outer LLM call is handled by TracedExecutionBackend wrapper.
 * This backend only creates child spans for tool calls and turns (internal details).
 */

import { isAbsolute } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import {
	createCodingTools,
	createEventBus,
	discoverAndLoadExtensions,
} from "@mariozechner/pi-coding-agent";
import { trace } from "@opentelemetry/api";
import type { ArtifactData } from "../../domain/models/artifact.model.js";
import type {
	AgentEvent,
	BudgetExceededEvent,
} from "../../domain/models/events.model.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	ConversationEntry,
	IExecutionBackend,
} from "../../domain/ports/execution-backend.port.js";
import { endSpan, startStepSpan } from "../../observability/spans.js";
import { maskSecrets } from "../secrets/secret-registry.js";
import { checkBudget, computeCostUsd } from "./budget-check.js";
import type { EventCallback, ProgressCallback } from "./pi-ai-backend.js";
import { isOverloadedError, retryWithBackoff } from "./retry.js";

export class PiCodingAgentExecutionBackend implements IExecutionBackend {
	private onProgress?: ProgressCallback;
	private onEvent?: EventCallback;
	private workdir?: string;
	private agentforgeDir?: string;

	constructor(options?: {
		onProgress?: ProgressCallback;
		onEvent?: EventCallback;
		workdir?: string;
		agentforgeDir?: string;
	}) {
		this.onProgress = options?.onProgress;
		// Wrap onEvent to mask registered secrets in content (P32-T7).
		const rawOnEvent = options?.onEvent;
		this.onEvent = rawOnEvent
			? (entry: ConversationEntry) =>
					rawOnEvent({ ...entry, content: maskSecrets(entry.content) })
			: undefined;
		this.workdir = options?.workdir;
		this.agentforgeDir = options?.agentforgeDir;
	}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const startTime = Date.now();

		const model = getModel(
			request.model.provider as Parameters<typeof getModel>[0],
			request.model.name as Parameters<typeof getModel>[1],
		);

		// Validate extension paths before any execution
		if (request.extensions && request.extensions.length > 0) {
			const invalid = validateExtensionPaths(request.extensions);
			if (invalid) {
				const durationMs = Date.now() - startTime;
				return {
					artifacts: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					durationMs,
					events: [
						{ kind: "error" as const, timestamp: Date.now(), message: invalid },
					],
				};
			}
		}

		let tools = this.workdir ? createCodingTools(this.workdir) : [];

		// Filter tools by YAML tools list when specified (non-empty).
		// Extension tools are merged after this filter so they always pass through.
		if (request.tools && request.tools.length > 0) {
			const allowed = new Set(request.tools);
			tools = tools.filter((t) => allowed.has(t.name));
		}

		// Load YAML-referenced extensions and merge their registered tools.
		// Extensions resolve relative to agentforgeDir (.agentforge/ by default).
		if (request.extensions && request.extensions.length > 0) {
			const cwd = this.agentforgeDir ?? this.workdir ?? process.cwd();
			const eventBus = createEventBus();
			const { extensions: loaded, errors } = await discoverAndLoadExtensions(
				[...request.extensions],
				cwd,
				undefined,
				eventBus,
			);
			if (errors.length > 0) {
				const durationMs = Date.now() - startTime;
				const message = errors
					.map(
						(e: { path: string; error: string }) =>
							`Failed to load extension ${e.path}: ${e.error}`,
					)
					.join("; ");
				return {
					artifacts: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					durationMs,
					events: [{ kind: "error" as const, timestamp: Date.now(), message }],
				};
			}
			const extensionTools = loaded.flatMap((ext) =>
				Array.from(ext.tools.values()).map((t) => t.definition),
			) as unknown as typeof tools;
			tools = [...tools, ...extensionTools];
		}

		const agent = new Agent({
			initialState: {
				systemPrompt: request.systemPrompt,
				model,
				thinkingLevel: "medium",
				tools,
				messages: [],
			},
			convertToLlm: (messages: AgentMessage[]) =>
				messages.filter(
					(m): m is Message =>
						"role" in m &&
						(m.role === "user" ||
							m.role === "assistant" ||
							m.role === "toolResult"),
				),
		});

		let textBuffer = "";
		const activeToolSpans: ReturnType<typeof startStepSpan>[] = [];
		let turnSpan: ReturnType<typeof startStepSpan> | undefined;
		let budgetAborted = false;

		agent.subscribe((event) => {
			if (event.type === "message_update") {
				this.onProgress?.({ type: "progress", text: "generating..." });
				const ame = (
					event as unknown as {
						assistantMessageEvent?: { type: string; delta?: string };
					}
				).assistantMessageEvent;
				if (ame?.type === "text_delta" && ame.delta) {
					textBuffer += ame.delta;
					if (textBuffer.length >= 200) {
						this.onEvent?.({
							role: "assistant",
							content: textBuffer,
							timestamp: Date.now(),
						});
						textBuffer = "";
					}
				} else if (ame?.type === "thinking_delta" && ame.delta) {
					const parentSpan = trace.getActiveSpan();
					parentSpan?.addEvent("llm.thinking", {
						"thinking.content": ame.delta.slice(0, 4096),
					});
					this.onEvent?.({
						role: "assistant",
						content: `[thinking] ${ame.delta.slice(0, 300)}`,
						timestamp: Date.now(),
					});
				}
			} else if (event.type === "message_end") {
				if (textBuffer.length > 0) {
					this.onEvent?.({
						role: "assistant",
						content: textBuffer,
						timestamp: Date.now(),
					});
					textBuffer = "";
				}
			} else if (event.type === "tool_execution_start") {
				if (textBuffer.length > 0) {
					this.onEvent?.({
						role: "assistant",
						content: textBuffer,
						timestamp: Date.now(),
					});
					textBuffer = "";
				}
				const toolName = (event as unknown as Record<string, unknown>)
					.toolName as string;
				const args = JSON.stringify(
					(event as unknown as Record<string, unknown>).args ?? "",
				).slice(0, 500);
				const toolSpan = startStepSpan({
					stepName: `agent.step tool.${toolName}`,
					stepType: "tool",
				});
				toolSpan.setAttribute("tool.name", toolName);
				toolSpan.setAttribute("tool.args", args);
				activeToolSpans.push(toolSpan);
				this.onEvent?.({
					role: "tool_call",
					content: args,
					name: toolName,
					timestamp: Date.now(),
				});
			} else if (event.type === "tool_execution_end") {
				const raw = event as unknown as Record<string, unknown>;
				const result = String(raw.output ?? raw.result ?? "").slice(0, 500);
				const toolSpan = activeToolSpans.pop();
				if (toolSpan) {
					toolSpan.setAttribute("tool.result", result);
					endSpan(toolSpan, "ok");
				}
				this.onEvent?.({
					role: "tool_result",
					content: result,
					name: raw.toolName as string | undefined,
					timestamp: Date.now(),
				});
			} else if (event.type === "turn_start") {
				turnSpan = startStepSpan({
					stepName: "agent.step turn",
					stepType: "turn",
				});
				this.onEvent?.({
					role: "assistant",
					content: "[turn_start]",
					timestamp: Date.now(),
				});
			} else if (event.type === "turn_end") {
				if (turnSpan) {
					endSpan(turnSpan, "ok");
					turnSpan = undefined;
				}
				this.onEvent?.({
					role: "assistant",
					content: "[turn_end]",
					timestamp: Date.now(),
				});
				// Per-turn budget check: abort before the next turn starts.
				if (request.budget && !budgetAborted) {
					const currentMessages = (
						agent.state.messages as AgentMessage[]
					).filter(
						(m) =>
							"role" in m &&
							(m as unknown as Record<string, unknown>).role === "assistant",
					);
					const currentUsage = aggregateTokenUsage(currentMessages);
					const totalTokens =
						currentUsage.inputTokens + currentUsage.outputTokens;
					const costUsd = computeCostUsd(
						{
							inputTokens: currentUsage.inputTokens,
							outputTokens: currentUsage.outputTokens,
						},
						request.model.name,
					);
					const budgetCheck = checkBudget(totalTokens, costUsd, request.budget);
					if (budgetCheck.exceeded) {
						budgetAborted = true;
						agent.abort();
					}
				}
			}
		});

		const userPrompt = this.buildPrompt(request);

		this.onEvent?.({
			role: "assistant",
			content: `[started] Running coding agent (${request.model.provider}/${request.model.name})...`,
			timestamp: Date.now(),
		});

		// Cancellation: when the caller aborts the request, propagate to the
		// pi-agent-core Agent which supports abort() natively (stops the current
		// LLM call + tool chain). Re-entrant safe: abort() is idempotent.
		if (request.signal) {
			if (request.signal.aborted) {
				agent.abort();
			} else {
				request.signal.addEventListener("abort", () => agent.abort(), {
					once: true,
				});
			}
		}

		try {
			await retryWithBackoff(
				() => agent.prompt(userPrompt),
				isOverloadedError,
				{
					signal: request.signal,
					onRetry: ({ attempt, delayMs }) => {
						this.onEvent?.({
							role: "assistant",
							content: `[retry] Anthropic overloaded_error — retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1})`,
							timestamp: Date.now(),
						});
					},
				},
			);

			const state = agent.state;
			const messages = state.messages;

			const assistantMessages = (messages as AgentMessage[]).filter(
				(m) =>
					"role" in m &&
					(m as unknown as Record<string, unknown>).role === "assistant",
			);
			const lastAssistant = assistantMessages[assistantMessages.length - 1];

			const artifacts = this.parseArtifacts(
				lastAssistant as unknown as Record<string, unknown>,
			);
			const durationMs = Date.now() - startTime;
			const conversationLog = this.buildConversationLog(
				messages as AgentMessage[],
				request.systemPrompt,
			);

			this.onEvent?.({
				role: "assistant",
				content: `[completed] Generated ${artifacts.length} artifacts in ${(durationMs / 1000).toFixed(1)}s`,
				timestamp: Date.now(),
			});

			// Aggregate token usage across all assistant messages in the state.
			// pi-agent-core doesn't roll this up for us — each AssistantMessage
			// carries its own turn-level `usage` and we sum them for the full run.
			const tokenUsage = aggregateTokenUsage(assistantMessages);

			// Budget check: after the run, verify cumulative usage against limits.
			// For multi-turn agents the check runs post-run (abort is not
			// retroactive, but surfacing the event lets callers and operators know).
			const events: AgentEvent[] = [];
			if (request.budget) {
				const totalTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
				const costUsd = computeCostUsd(
					{
						inputTokens: tokenUsage.inputTokens,
						outputTokens: tokenUsage.outputTokens,
					},
					request.model.name,
				);
				const budgetCheck = checkBudget(totalTokens, costUsd, request.budget);
				if (budgetCheck.exceeded) {
					const ev: BudgetExceededEvent = {
						kind: "budget_exceeded",
						timestamp: Date.now(),
						reason: budgetCheck.reason ?? "Budget exceeded",
						totalTokens,
						budgetTokens: request.budget.maxTotalTokens,
						costUsd,
						budgetCostUsd: request.budget.maxCostUsd,
					};
					events.push(ev);
				}
			}

			return {
				artifacts,
				tokenUsage,
				durationMs,
				events,
				conversationLog: conversationLog.map((e) => ({
					...e,
					content: maskSecrets(e.content),
				})),
			};
		} catch (err: unknown) {
			const durationMs = Date.now() - startTime;
			const message = maskSecrets(
				err instanceof Error ? err.message : "Unknown error during agent run",
			);

			// Clean up dangling tool/turn spans
			for (const ts of activeToolSpans) endSpan(ts, "error", message);
			activeToolSpans.length = 0;
			if (turnSpan) {
				endSpan(turnSpan, "error", message);
				turnSpan = undefined;
			}

			const errorEvent: AgentEvent = {
				kind: "error",
				timestamp: Date.now(),
				message,
			};

			return {
				artifacts: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				durationMs,
				events: [errorEvent],
			};
		}
	}

	private buildPrompt(request: AgentRunRequest): string {
		const parts: string[] = [];

		if (request.inputArtifacts.length > 0) {
			parts.push("## Input Artifacts\n");
			for (const artifact of request.inputArtifacts) {
				parts.push(`### ${artifact.path} (${artifact.type})\n`);
				parts.push(artifact.content);
				parts.push("");
			}
		}

		parts.push(
			"\n\n## Output Instructions\n" +
				"Review the input artifacts and produce the required outputs.\n" +
				"Write all output files to the current working directory.\n" +
				'If producing structured data, output a JSON object with an "artifacts" key.',
		);

		return parts.join("\n");
	}

	private parseArtifacts(
		lastAssistant: Record<string, unknown>,
	): ArtifactData[] {
		if (!lastAssistant) return [];
		const content = lastAssistant.content;
		if (!Array.isArray(content)) return [];

		const fullText = (content as Array<Record<string, unknown>>)
			.filter((c) => c.type === "text" && typeof c.text === "string")
			.map((c) => c.text as string)
			.join("");

		if (!fullText) return [];

		const jsonStr = this.extractJson(fullText);
		if (!jsonStr) return [];

		try {
			const parsed = JSON.parse(jsonStr);
			if (!parsed || typeof parsed !== "object") return [];
			const obj = parsed.artifacts ?? parsed;
			if (typeof obj !== "object") return [];

			const artifacts: ArtifactData[] = [];
			for (const [key, value] of Object.entries(obj)) {
				if (value && typeof value === "object") {
					artifacts.push({
						type: key as ArtifactData["type"],
						path: `${key}.json`,
						content: JSON.stringify(value),
					});
				}
			}
			return artifacts;
		} catch {
			return [];
		}
	}

	private extractJson(text: string): string | null {
		const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
		if (codeBlockMatch) return codeBlockMatch[1].trim();
		const firstBrace = text.indexOf("{");
		const lastBrace = text.lastIndexOf("}");
		if (firstBrace !== -1 && lastBrace > firstBrace) {
			return text.slice(firstBrace, lastBrace + 1);
		}
		return null;
	}

	private buildConversationLog(
		messages: AgentMessage[],
		systemPrompt: string,
	): ConversationEntry[] {
		const entries: ConversationEntry[] = [];
		entries.push({
			role: "system",
			content: systemPrompt,
			timestamp: Date.now(),
		});
		for (const msg of messages) {
			const m = msg as unknown as Record<string, unknown>;
			const role = m.role as string;
			if (role === "user") {
				entries.push({
					role: "user",
					content:
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
					timestamp: (m.timestamp as number) ?? Date.now(),
				});
			} else if (role === "assistant") {
				const content = Array.isArray(m.content)
					? (m.content as Array<Record<string, unknown>>)
							.filter((c) => c.type === "text")
							.map((c) => c.text as string)
							.join("")
					: String(m.content ?? "");
				if (content) {
					entries.push({
						role: "assistant",
						content,
						timestamp: (m.timestamp as number) ?? Date.now(),
					});
				}
			} else if (role === "toolResult") {
				entries.push({
					role: "tool_result",
					content: String(
						(m as Record<string, unknown>).output ??
							(m as Record<string, unknown>).result ??
							"",
					).slice(0, 500),
					name: m.toolName as string | undefined,
					timestamp: (m.timestamp as number) ?? Date.now(),
				});
			}
		}
		return entries;
	}
}

/**
 * Sum token usage across every assistant turn in the state, and convert
 * Anthropic cache-read/cache-write counters into provider-agnostic extras
 * on the TokenUsage shape.
 */
function aggregateTokenUsage(
	assistantMessages: AgentMessage[],
): import("../../domain/ports/execution-backend.port.js").TokenUsage {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;

	for (const msg of assistantMessages) {
		const usage = (msg as unknown as Record<string, unknown>).usage as
			| Record<string, number>
			| undefined;
		if (!usage) continue;
		inputTokens += usage.input ?? 0;
		outputTokens += usage.output ?? 0;
		cacheReadTokens += usage.cacheRead ?? 0;
		cacheWriteTokens += usage.cacheWrite ?? 0;
	}

	const extras: Array<{
		kind: string;
		tokens: number;
		costMultiplier: number;
	}> = [];
	if (cacheReadTokens > 0) {
		extras.push({
			kind: "anthropic.cacheRead",
			tokens: cacheReadTokens,
			costMultiplier: 0.1,
		});
	}
	if (cacheWriteTokens > 0) {
		extras.push({
			kind: "anthropic.cacheWrite5m",
			tokens: cacheWriteTokens,
			costMultiplier: 1.25,
		});
	}

	return {
		inputTokens,
		outputTokens,
		extras: extras.length > 0 ? extras : undefined,
	};
}

/**
 * Validate extension paths: only relative paths allowed, no directory traversal.
 * Returns an error message if invalid, null if all paths are valid.
 */
function validateExtensionPaths(extensions: readonly string[]): string | null {
	for (const ext of extensions) {
		if (isAbsolute(ext)) {
			return `Extension path must be relative, not absolute: ${ext}`;
		}
		if (ext.includes("..")) {
			return `Extension path must not contain directory traversal (..): ${ext}`;
		}
	}
	return null;
}
