/**
 * LocalAgentExecutor — runs agents in the same process as the control plane.
 * Implements IAgentExecutor. Used for development and single-machine deployments.
 *
 * This executor has ZERO knowledge of the state store or pipeline controller.
 * It receives a complete AgentJob and returns an AgentJobResult.
 */

import { mkdirSync } from "node:fs";
import { AgentTimeoutError, createAgent } from "../../agents/runner.js";
import type { Container, ExecutorType } from "../../di/container.js";
import type { AgentRunExitReason } from "../../domain/models/agent-run.model.js";
import type { ArtifactData } from "../../domain/models/artifact.model.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "../../domain/ports/agent-executor.port.js";
import type { ConversationEntry } from "../../domain/ports/execution-backend.port.js";
import { estimateCostUsd } from "../../utils/cost-calculator.js";
import type { EventCallback } from "./pi-ai-backend.js";

/** Per-run cancellation handle. */
interface ActiveRun {
	readonly abortController: AbortController;
}

export interface LocalAgentExecutorOptions {
	/**
	 * Factory function to create a DI container for agent execution. Must accept
	 * an onEvent callback so streaming conversation entries from the backend
	 * can be forwarded to the executor's onStatus stream.
	 */
	createContainerFn: (
		executor: ExecutorType,
		workdir: string,
		onEvent?: EventCallback,
	) => Container;
}

export class LocalAgentExecutor implements IAgentExecutor {
	private readonly createContainerFn: LocalAgentExecutorOptions["createContainerFn"];
	private readonly activeRuns = new Map<string, ActiveRun>();

	constructor(options: LocalAgentExecutorOptions) {
		this.createContainerFn = options.createContainerFn;
	}

	async execute(
		job: AgentJob,
		onStatus?: (update: StatusUpdate) => void,
	): Promise<AgentJobResult> {
		const startTime = Date.now();

		// Register cancellation handle before any work so cancel() called mid-setup
		// still lands. The backend receives controller.signal via request.signal
		// (wired inside the backend adapters) and reacts by calling agent.abort().
		const abortController = new AbortController();
		this.activeRuns.set(job.runId, { abortController });

		onStatus?.({
			type: "started",
			runId: job.runId,
			timestamp: Date.now(),
		});

		try {
			mkdirSync(job.outputDir, { recursive: true });
			mkdirSync(job.workdir, { recursive: true });

			const executorType =
				(job.agentDefinition.spec?.executor as ExecutorType) ?? "pi-ai";

			// Convert every backend-emitted ConversationEntry into a
			// conversation_entry StatusUpdate so the control plane can persist it
			// incrementally. When the backend runs inside a child container
			// (DockerAgentExecutor), these updates are serialized to stdout JSONL
			// and parsed back on the parent side by parseStatusStream — same shape.
			const forwardEvent: EventCallback = (entry) => {
				onStatus?.({
					type: "conversation_entry",
					runId: job.runId,
					conversationEntry: entry,
					timestamp: entry.timestamp ?? Date.now(),
				});
			};

			const container = this.createContainerFn(
				executorType,
				job.workdir,
				forwardEvent,
			);
			const runner = createAgent(job.agentId, container);

			const prompt = job.revisionNotes
				? `## Revision Request\nThe reviewer has requested changes:\n${job.revisionNotes}\n\nPlease address the feedback above in your revised output.`
				: undefined;

			const input = this.buildInput(job.inputs);

			const result = await runner.run({
				input,
				prompt,
				outputDir: job.outputDir,
				signal: abortController.signal,
			});

			const durationMs = Date.now() - startTime;
			// Pass the full TokenUsage (including extras) so the calculator can
			// price Anthropic cache reads/writes, OpenAI reasoning tokens, etc.
			const costUsd = estimateCostUsd(job.model.name, result.tokenUsage);

			const jobResult: AgentJobResult = {
				status: "succeeded",
				artifacts: result.artifacts as readonly ArtifactData[],
				savedFiles: result.savedFiles as readonly string[],
				tokenUsage: result.tokenUsage,
				costUsd,
				durationMs,
				conversationLog:
					(result.conversationLog as readonly ConversationEntry[]) ?? [],
			};

			onStatus?.({
				type: "completed",
				runId: job.runId,
				timestamp: Date.now(),
			});

			return jobResult;
		} catch (err) {
			const durationMs = Date.now() - startTime;
			const message = err instanceof Error ? err.message : String(err);
			const wasCancelled = abortController.signal.aborted;
			// ADR-0003: distinguish wall-clock timeouts from cancellations and
			// other errors so the dashboard can render a "Timeout: Xs" badge.
			const exitReason: AgentRunExitReason | undefined = wasCancelled
				? "cancelled"
				: err instanceof AgentTimeoutError
					? "timeout"
					: "error";

			// Recover partial token/conversation data from step pipeline failures
			const partial = (
				err as Error & {
					partialResult?: {
						tokenUsage: { inputTokens: number; outputTokens: number };
						conversationLog?: readonly ConversationEntry[];
						artifacts?: readonly ArtifactData[];
					};
				}
			).partialResult;
			const tokenUsage = partial?.tokenUsage ?? {
				inputTokens: 0,
				outputTokens: 0,
			};
			const costUsd = estimateCostUsd(job.model.name, tokenUsage);

			onStatus?.({
				type: "failed",
				runId: job.runId,
				message: wasCancelled ? "cancelled" : message,
				timestamp: Date.now(),
			});

			return {
				status: "failed",
				artifacts: (partial?.artifacts as readonly ArtifactData[]) ?? [],
				savedFiles: [],
				tokenUsage,
				costUsd,
				durationMs,
				conversationLog:
					(partial?.conversationLog as readonly ConversationEntry[]) ?? [],
				error: wasCancelled ? "cancelled" : message,
				exitReason,
			};
		} finally {
			this.activeRuns.delete(job.runId);
		}
	}

	async cancel(runId: string): Promise<void> {
		const active = this.activeRuns.get(runId);
		if (!active) return;
		active.abortController.abort();
	}

	private buildInput(
		inputs: readonly ArtifactData[],
	): string | string[] | undefined {
		if (inputs.length === 0) return undefined;
		if (inputs.length === 1) return inputs[0].content;
		return inputs.map((a) => a.content);
	}
}
