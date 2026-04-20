/**
 * RemoteAgentExecutor — sends agent jobs to a remote executor node over HTTP.
 * Uses SSE streaming on GET /events/:runId to receive live StatusUpdate events
 * (including conversation_entry fragments), then fetches the full AgentJobResult
 * from GET /result/:runId after the stream closes.
 */

import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "agentforge-core/domain/ports/agent-executor.port.js";

export class RemoteAgentExecutor implements IAgentExecutor {
	constructor(private readonly baseUrl: string) {}

	async execute(
		job: AgentJob,
		onStatus?: (update: StatusUpdate) => void,
	): Promise<AgentJobResult> {
		const startTime = Date.now();

		try {
			// 1. POST /execute — submit the job
			const executeRes = await fetch(`${this.baseUrl}/execute`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(job),
			});

			if (!executeRes.ok) {
				throw new Error(
					`Executor returned ${executeRes.status}: ${await executeRes.text()}`,
				);
			}

			const { runId } = (await executeRes.json()) as { runId: string };

			// 2. GET /events/:runId — stream SSE StatusUpdate events
			const eventsRes = await fetch(`${this.baseUrl}/events/${runId}`);
			if (!eventsRes.ok) {
				throw new Error(
					`Events stream returned ${eventsRes.status}: ${await eventsRes.text()}`,
				);
			}

			if (!eventsRes.body) {
				throw new Error("Events response has no body");
			}

			await parseSseStream(eventsRes.body, (update) => {
				onStatus?.(update);
			});

			// 3. GET /result/:runId — fetch full result with conversationLog
			const resultRes = await fetch(`${this.baseUrl}/result/${runId}`);
			if (!resultRes.ok) {
				throw new Error(
					`Result fetch failed: ${resultRes.status}: ${await resultRes.text()}`,
				);
			}

			return (await resultRes.json()) as AgentJobResult;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const durationMs = Date.now() - startTime;

			onStatus?.({
				type: "failed",
				runId: job.runId,
				message,
				timestamp: Date.now(),
			});

			return {
				status: "failed",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				costUsd: 0,
				durationMs,
				conversationLog: [],
				error: message,
			};
		}
	}

	async cancel(runId: string): Promise<void> {
		await fetch(`${this.baseUrl}/cancel/${runId}`, { method: "POST" });
	}
}

/**
 * Parse a server-sent events stream and call onEvent for each parsed event.
 * SSE format: one or more `data: {...}\n` lines followed by a blank line `\n`.
 */
async function parseSseStream(
	body: ReadableStream<Uint8Array>,
	onEvent: (update: StatusUpdate) => void,
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// SSE events are separated by double newline
			const parts = buffer.split("\n\n");
			buffer = parts.pop() ?? "";

			for (const part of parts) {
				for (const line of part.split("\n")) {
					if (line.startsWith("data: ")) {
						try {
							const update = JSON.parse(line.slice(6)) as StatusUpdate;
							onEvent(update);
						} catch {
							// Skip malformed lines
						}
					}
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
