/**
 * PiAiExecutionBackend — lightweight IExecutionBackend using @mariozechner/pi-ai.
 * Used by document-producing agents that need
 * LLM conversation only, no file tools.
 */

import type {
	AssistantMessage,
	Context,
	UserMessage,
} from "@mariozechner/pi-ai";
import { getModel, stream } from "@mariozechner/pi-ai";
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
import { maskSecrets } from "../secrets/secret-registry.js";
import { checkBudget, computeCostUsd } from "./budget-check.js";
import {
	humanizeErrorMessage,
	isOverloadedError,
	retryWithBackoff,
} from "./retry.js";

export type ProgressCallback = (event: {
	type: string;
	text?: string;
	tokensOut?: number;
}) => void;

/** Callback for real-time log entries during execution */
export type EventCallback = (entry: ConversationEntry) => void;

export class PiAiExecutionBackend implements IExecutionBackend {
	private onProgress?: ProgressCallback;
	private onEvent?: EventCallback;

	constructor(options?: {
		onProgress?: ProgressCallback;
		onEvent?: EventCallback;
	}) {
		this.onProgress = options?.onProgress;
		// Wrap onEvent to mask registered secrets in the content field. Keeps
		// conversation logs and dashboard views free of API keys, connection
		// strings, and anything else registered with the secret registry (P32-T7).
		const rawOnEvent = options?.onEvent;
		this.onEvent = rawOnEvent
			? (entry: ConversationEntry) =>
					rawOnEvent({ ...entry, content: maskSecrets(entry.content) })
			: undefined;
	}

	async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
		const model = getModel(
			request.model.provider as Parameters<typeof getModel>[0],
			request.model.name as Parameters<typeof getModel>[1],
		);

		const context: Context = {
			systemPrompt: request.systemPrompt,
			messages: this.buildMessages(request),
		};

		const startTime = Date.now();

		try {
			// Emit start event
			this.onEvent?.({
				role: "assistant",
				content: `[started] Calling LLM (${request.model.provider}/${request.model.name})...`,
				timestamp: Date.now(),
			});

			const streamOnce = async (): Promise<{
				response: AssistantMessage;
				outputTokens: number;
			}> => {
				const s = stream(model, context, {
					maxTokens: request.model.maxTokens,
					signal: request.signal,
				});

				let outputTokens = 0;
				let textBuffer = "";

				for await (const event of s) {
					if (event.type === "text_delta") {
						outputTokens++;
						const delta = (event as unknown as { delta?: string }).delta ?? "";
						textBuffer += delta;

						// Flush actual text every ~200 chars
						if (textBuffer.length >= 200) {
							this.onProgress?.({
								type: "progress",
								tokensOut: outputTokens,
							});
							this.onEvent?.({
								role: "assistant",
								content: textBuffer,
								timestamp: Date.now(),
							});
							textBuffer = "";
						}
					} else if (event.type === "thinking_delta") {
						const delta = (event as unknown as { delta?: string }).delta ?? "";
						if (delta) {
							this.onEvent?.({
								role: "assistant",
								content: `[thinking] ${delta.slice(0, 300)}`,
								timestamp: Date.now(),
							});
						}
					} else if (event.type === "error") {
						const errEvent = event as Record<string, unknown>;
						const errObj = errEvent.error ?? errEvent.message ?? event;
						const errMsg =
							typeof errObj === "string" ? errObj : JSON.stringify(errObj);
						throw new Error(errMsg);
					}
				}

				// Flush remaining text buffer
				if (textBuffer.length > 0) {
					this.onEvent?.({
						role: "assistant",
						content: textBuffer,
						timestamp: Date.now(),
					});
					textBuffer = "";
				}

				const resp = await s.result();

				// Check for error stop reason — throw so retry can catch it
				if (resp.stopReason === "error") {
					const raw =
						((resp as unknown as Record<string, unknown>).errorMessage as
							| string
							| undefined) ?? "LLM returned error stop reason";
					throw new Error(humanizeErrorMessage(raw));
				}

				return { response: resp, outputTokens };
			};

			const { response, outputTokens } = await retryWithBackoff(
				streamOnce,
				isOverloadedError,
				{
					signal: request.signal,
					onRetry: ({ attempt, delayMs }) => {
						this.onEvent?.({
							role: "assistant",
							content: `[retry] Anthropic overloaded_error — retrying in ${Math.round(
								delayMs / 1000,
							)}s (attempt ${attempt + 1})`,
							timestamp: Date.now(),
						});
					},
				},
			);
			const durationMs = Date.now() - startTime;

			const artifacts = this.parseArtifacts(response);
			const conversationLog = this.buildConversationLog(context, response);

			this.onEvent?.({
				role: "assistant",
				content: `[completed] Generated ${artifacts.length} artifacts, ${response.usage?.output ?? outputTokens} tokens`,
				timestamp: Date.now(),
			});

			// Anthropic ephemeral cache billing:
			// - cache read (hit)   = 0.1× input price
			// - cache write (5m)   = 1.25× input price (pi-ai only exposes 5m)
			const extras: Array<{
				kind: string;
				tokens: number;
				costMultiplier: number;
			}> = [];
			const cacheRead = response.usage?.cacheRead ?? 0;
			const cacheWrite = response.usage?.cacheWrite ?? 0;
			if (cacheRead > 0) {
				extras.push({
					kind: "anthropic.cacheRead",
					tokens: cacheRead,
					costMultiplier: 0.1,
				});
			}
			if (cacheWrite > 0) {
				extras.push({
					kind: "anthropic.cacheWrite5m",
					tokens: cacheWrite,
					costMultiplier: 1.25,
				});
			}

			const inputTokens = response.usage?.input ?? 0;
			const outputTokensActual = response.usage?.output ?? 0;
			const tokenUsage = {
				inputTokens,
				outputTokens: outputTokensActual,
				extras: extras.length > 0 ? extras : undefined,
			};

			// Budget check: single-turn cannot abort mid-call, so attach a
			// budget_exceeded warning event to the result if limits are hit.
			const events: AgentEvent[] = [];
			if (request.budget) {
				const totalTokens = inputTokens + outputTokensActual;
				const costUsd = computeCostUsd(
					{ inputTokens, outputTokens: outputTokensActual },
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
				humanizeErrorMessage(err) || "Unknown error during LLM call",
			);

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

	private buildMessages(request: AgentRunRequest): UserMessage[] {
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
			"\n\n## CRITICAL OUTPUT INSTRUCTIONS\n" +
				"Respond with ONLY a single JSON object — no commentary before or after.\n" +
				"The JSON must have an `artifacts` key. Each artifact key is the type name (e.g. `frd`, `nfr`) and the value is the artifact data object.\n" +
				"Be concise in string values — avoid filler text. Keep the total response under 50,000 tokens.\n" +
				'Example structure: { "artifacts": { "frd": { ... }, "nfr": { ... } } }',
		);

		const userMessage: UserMessage = {
			role: "user",
			content: parts.join("\n"),
			timestamp: Date.now(),
		};

		return [userMessage];
	}

	private parseArtifacts(response: AssistantMessage): ArtifactData[] {
		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		if (!text) return [];

		const jsonStr = this.extractJson(text);
		if (!jsonStr) return [];

		try {
			const parsed = JSON.parse(jsonStr);
			if (!parsed || typeof parsed !== "object") return [];

			// Handle { "artifacts": { "frd": {...}, "nfr": {...} } }
			const artifactsObj = parsed.artifacts ?? parsed;
			if (typeof artifactsObj !== "object") return [];

			const results: ArtifactData[] = [];
			for (const [key, value] of Object.entries(artifactsObj)) {
				if (value && typeof value === "object") {
					results.push({
						type: key as ArtifactData["type"],
						path: `${key}.json`,
						content: JSON.stringify(value),
					});
				}
			}
			return results;
		} catch {
			return [];
		}
	}

	private buildConversationLog(
		context: Context,
		response: AssistantMessage,
	): ConversationEntry[] {
		const entries: ConversationEntry[] = [];

		if (context.systemPrompt) {
			entries.push({
				role: "system",
				content: context.systemPrompt,
				timestamp: Date.now(),
			});
		}

		for (const msg of context.messages) {
			entries.push({
				role: "user",
				content:
					typeof msg.content === "string"
						? msg.content
						: JSON.stringify(msg.content),
				timestamp: msg.timestamp,
			});
		}

		const assistantText = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("");

		entries.push({
			role: "assistant",
			content: assistantText,
			timestamp: response.timestamp,
		});

		return entries;
	}

	private extractJson(text: string): string | null {
		// Try markdown code block first: ```json ... ``` or ``` ... ```
		const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
		if (codeBlockMatch) {
			return codeBlockMatch[1].trim();
		}

		// Try to find a top-level JSON object in the text
		const firstBrace = text.indexOf("{");
		const lastBrace = text.lastIndexOf("}");
		if (firstBrace !== -1 && lastBrace > firstBrace) {
			return text.slice(firstBrace, lastBrace + 1);
		}

		return null;
	}
}
