/**
 * Shared pipeline execution loop.
 * Executes pending agent runs, chains artifacts between phases,
 * injects revision notes, and stops when the pipeline pauses at a gate or finishes.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getAgentInfo } from "../agents/registry.js";
import type { PipelineController } from "../control-plane/pipeline-controller.js";
import type { PipelineDefinitionYaml } from "../definitions/parser.js";
import type { AppConfig } from "../di/config.js";
import type { AgentRunRecord } from "../domain/models/agent-run.model.js";
import type { ArtifactData } from "../domain/models/artifact.model.js";
import type {
	AgentJob,
	IAgentExecutor,
} from "../domain/ports/agent-executor.port.js";
import type { IStateStore } from "../domain/ports/state-store.port.js";
import { createMetricsRecorder } from "../observability/metrics.js";
import {
	endSpan,
	startAgentRunSpan,
	startPipelineSpan,
	withSpanContext,
} from "../observability/spans.js";

export interface ExecuteResult {
	pausedAtGate: boolean;
	gateId?: string;
	phaseCompleted?: number;
	phaseNext?: number;
}

const MAX_ITERATIONS = 100;
const metrics = createMetricsRecorder();

/**
 * Runs all pending agent runs for a pipeline until it pauses at a gate or completes.
 *
 * Artifact chaining:
 *   - phase1Inputs are passed as input to phase 1 agents (user-provided files/inline text)
 *   - phase N+1 agents receive the phase N output dir as input
 *   - On cross-process resume (e.g. after gate approval), the last completed phase is
 *     derived from the state store so chaining continues correctly
 *
 * Revision notes are injected as an extra prompt when present on the agent run record.
 */
export async function executePipeline(
	pipelineRunId: string,
	_projectName: string,
	store: IStateStore,
	controller: PipelineController,
	config: AppConfig,
	/** Base output directory; phase subdirs are created beneath it */
	outputBase: string,
	/** Pipeline definition — used to detect parallel phases */
	pipelineDef: PipelineDefinitionYaml | undefined,
	/** Input files/values for phase 1 agents (from --input flags) */
	phase1Inputs: string[] | Record<string, string> | undefined,
	/** Required executor — all execution goes through IAgentExecutor (P18). */
	executor: IAgentExecutor,
): Promise<ExecuteResult> {
	const pipelineSpan = startPipelineSpan({
		pipelineId: pipelineRunId,
		pipelineName: pipelineDef?.metadata.name ?? "unknown",
		projectName: _projectName,
	});

	try {
		return await executePipelineInner(
			pipelineRunId,
			_projectName,
			store,
			controller,
			config,
			outputBase,
			pipelineDef,
			phase1Inputs,
			executor,
			pipelineSpan,
		);
	} catch (err) {
		endSpan(
			pipelineSpan,
			"error",
			err instanceof Error ? err.message : String(err),
		);
		throw err;
	}
}

async function executePipelineInner(
	pipelineRunId: string,
	_projectName: string,
	store: IStateStore,
	controller: PipelineController,
	config: AppConfig,
	outputBase: string,
	pipelineDef: PipelineDefinitionYaml | undefined,
	phase1Inputs: string[] | Record<string, string> | undefined,
	executor: IAgentExecutor,
	pipelineSpan: import("@opentelemetry/api").Span,
): Promise<ExecuteResult> {
	let iterations = 0;

	// Seed allPrevPhaseDirs from already-succeeded runs so cross-process resumes
	// (e.g. after gate approve) pick up where the previous process left off.
	const allAgentRuns = await store.listAgentRuns(pipelineRunId);
	const succeededRuns = allAgentRuns.filter((r) => r.status === "succeeded");
	const lastCompletedPhase =
		succeededRuns.length > 0
			? Math.max(...succeededRuns.map((r) => r.phase))
			: undefined;
	// Accumulate ALL prior phase output dirs so later phases can access any artifact.
	const allPrevPhaseDirs: string[] = [];
	if (lastCompletedPhase !== undefined) {
		for (let p = 1; p <= lastCompletedPhase; p++) {
			allPrevPhaseDirs.push(join(outputBase, `phase-${p}`));
		}
	}

	while (iterations++ < MAX_ITERATIONS) {
		const pipeline = await store.getPipelineRun(pipelineRunId);
		if (!pipeline) break;

		if (
			pipeline.status === "completed" ||
			pipeline.status === "failed" ||
			pipeline.status === "cancelled"
		) {
			endSpan(pipelineSpan, pipeline.status === "failed" ? "error" : "ok");
			return { pausedAtGate: false };
		}

		if (pipeline.status === "paused_at_gate") {
			const gate = await store.getPendingGate(pipelineRunId);
			endSpan(pipelineSpan, "ok");
			return {
				pausedAtGate: true,
				gateId: gate?.id,
				phaseCompleted: gate?.phaseCompleted,
				phaseNext: gate?.phaseNext,
			};
		}

		const currentAgentRuns = await store.listAgentRuns(pipelineRunId);
		const allPending = currentAgentRuns.filter((r) => r.status === "pending");

		if (allPending.length === 0) break;

		// Only run agents from the lowest pending phase
		const currentPhase = Math.min(...allPending.map((r) => r.phase));
		const pendingRuns = allPending.filter((r) => r.phase === currentPhase);
		const phaseOutputDir = join(outputBase, `phase-${currentPhase}`);

		// Phase 1 agents get the user-provided inputs; all other phases get ALL
		// prior phase output dirs so any artifact from any earlier phase is available.
		let phaseInput: string | string[] | undefined;
		if (currentPhase === 1 && phase1Inputs) {
			if (Array.isArray(phase1Inputs) && phase1Inputs.length > 0) {
				phaseInput = phase1Inputs;
			} else if (
				!Array.isArray(phase1Inputs) &&
				Object.keys(phase1Inputs).length > 0
			) {
				// Format keyed inputs with headings so agent sees field names
				const formatted = Object.entries(phase1Inputs)
					.filter(([, v]) => v.trim())
					.map(([k, v]) => `## ${k}\n${v}`)
					.join("\n\n");
				phaseInput = formatted;
			}
		}
		if (!phaseInput && allPrevPhaseDirs.length > 0) {
			phaseInput = [...allPrevPhaseDirs]; // snapshot to avoid mutation after push
		}

		const isParallel =
			pipelineDef?.spec.phases.find((p) => p.phase === currentPhase)
				?.parallel === true;

		// Source code directory — shared across all phases
		const sourceDir = join(outputBase, "source");
		mkdirSync(sourceDir, { recursive: true });

		const runOne = (agentRun: AgentRunRecord) =>
			executeAgentRun(agentRun, {
				phaseInput,
				phaseOutputDir,
				sourceDir,
				config,
				controller,
				store,
				isParallel,
				executor,
				parentSpan: pipelineSpan,
			});

		if (isParallel) {
			const results = await Promise.allSettled(pendingRuns.map(runOne));
			// Check if any agent failed — log rejected promises but don't throw
			// (pipeline status is already set to "failed" by onAgentRunFailed)
			for (const result of results) {
				if (result.status === "rejected") {
					console.error(
						`  Agent failed during parallel execution: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
					);
				}
			}
		} else {
			for (const agentRun of pendingRuns) {
				await runOne(agentRun);
				// Stop executing further agents if the pipeline has been marked failed
				const pipelineAfterRun = await store.getPipelineRun(pipelineRunId);
				if (
					pipelineAfterRun?.status === "failed" ||
					pipelineAfterRun?.status === "cancelled"
				) {
					break;
				}
			}
		}

		// Check pipeline status after phase execution — stop if failed
		const pipelineAfterPhase = await store.getPipelineRun(pipelineRunId);
		if (
			pipelineAfterPhase?.status === "failed" ||
			pipelineAfterPhase?.status === "cancelled"
		) {
			endSpan(pipelineSpan, "error", "Pipeline failed during execution");
			return { pausedAtGate: false };
		}

		// Accumulate this phase's output dir so subsequent phases can access all artifacts
		allPrevPhaseDirs.push(phaseOutputDir);
	}

	const finalPipeline = await store.getPipelineRun(pipelineRunId);
	if (finalPipeline?.status === "paused_at_gate") {
		const gate = await store.getPendingGate(pipelineRunId);
		endSpan(pipelineSpan, "ok");
		return {
			pausedAtGate: true,
			gateId: gate?.id,
			phaseCompleted: gate?.phaseCompleted,
			phaseNext: gate?.phaseNext,
		};
	}
	endSpan(pipelineSpan, "ok");
	return { pausedAtGate: false };
}

interface AgentRunContext {
	phaseInput: string | string[] | undefined;
	phaseOutputDir: string;
	sourceDir: string;
	config: AppConfig;
	controller: PipelineController;
	store: IStateStore;
	isParallel?: boolean;
	executor: IAgentExecutor;
	parentSpan?: import("@opentelemetry/api").Span;
	runSpan?: import("@opentelemetry/api").Span;
}

async function executeAgentRun(
	agentRun: AgentRunRecord,
	ctx: AgentRunContext,
): Promise<void> {
	const span = startAgentRunSpan(
		{
			agentName: agentRun.agentName,
			runId: agentRun.id,
			phase: String(agentRun.phase),
			executor: "executor",
		},
		ctx.parentSpan,
	);
	ctx.runSpan = span;
	try {
		await withSpanContext(span, async () => {
			await executeAgentRunViaExecutor(agentRun, ctx, ctx.executor);
		});
	} catch (err) {
		endSpan(span, "error", err instanceof Error ? err.message : String(err));
		throw err;
	}
}

/**
 * P18 path: Builds an AgentJob from the agent run context and delegates
 * execution to the provided IAgentExecutor. Control plane handles state
 * updates from the result.
 */
async function executeAgentRunViaExecutor(
	agentRun: AgentRunRecord,
	ctx: AgentRunContext,
	executor: IAgentExecutor,
): Promise<void> {
	const displayName =
		getAgentInfo(agentRun.agentName)?.displayName ?? agentRun.agentName;
	const spinner = ctx.isParallel
		? null
		: ora(`  Running ${displayName}...`).start();
	if (ctx.isParallel) {
		console.log(`  Starting ${displayName}...`);
	}

	await ctx.store.updateAgentRun(agentRun.id, {
		status: "running",
		startedAt: new Date().toISOString(),
	});

	// Build AgentJob from context
	const inputs: ArtifactData[] = buildInputArtifacts(ctx.phaseInput);
	const job: AgentJob = {
		runId: agentRun.id,
		agentId: agentRun.agentName,
		agentDefinition: {
			metadata: { name: agentRun.agentName },
			spec: {
				executor: getAgentInfo(agentRun.agentName)?.executor ?? "pi-ai",
			},
		},
		inputs,
		workdir: ctx.sourceDir,
		outputDir: ctx.phaseOutputDir,
		model: {
			provider: ctx.config.llm.provider,
			name: ctx.config.llm.model,
			maxTokens: ctx.config.llm.maxTokens,
		},
		revisionNotes: agentRun.revisionNotes,
	};

	// Live conversation streaming: the executor emits `conversation_entry`
	// StatusUpdates as the agent makes progress. The control plane is the sink
	// of record — it writes them to a JSONL sidecar file in the phase output
	// dir, which the dashboard's resource-service reads for live display.
	// Same code path for local, docker, and remote executors.
	const sidecarPath = join(
		ctx.phaseOutputDir,
		`${agentRun.agentName}-conversation.jsonl`,
	);
	mkdirSync(ctx.phaseOutputDir, { recursive: true });
	const inputSummary = stringifyInput(ctx.phaseInput);
	writeFileSync(
		sidecarPath,
		`${JSON.stringify({
			role: "user",
			content: inputSummary,
			timestamp: Date.now(),
		})}\n`,
		"utf-8",
	);

	const result = await executor.execute(job, (update) => {
		if (update.type === "conversation_entry" && update.conversationEntry) {
			try {
				appendFileSync(
					sidecarPath,
					`${JSON.stringify(update.conversationEntry)}\n`,
					"utf-8",
				);
			} catch {
				// Best-effort streaming log — never fail the run because of sidecar IO
			}
		}
	});

	// Race guard: if the run was cancelled while the executor was busy, the
	// store already marked it failed ("Cancelled by user"). Discard any result
	// that comes in late — saving a "succeeded" status for a cancelled run
	// would overwrite the cancellation and leak artifacts into a stopped
	// pipeline.
	const currentRun = await ctx.store.getAgentRun(agentRun.id);
	if (
		currentRun?.status === "failed" &&
		currentRun.error === "Cancelled by user"
	) {
		const cancelMsg = chalk.yellow(
			`  ${displayName} cancelled — discarding late result`,
		);
		if (spinner) spinner.warn(cancelMsg);
		else console.log(cancelMsg);
		if (ctx.runSpan) endSpan(ctx.runSpan, "error", "Cancelled by user");
		return;
	}

	if (result.status === "succeeded") {
		await ctx.store.updateAgentRun(agentRun.id, {
			durationMs: result.durationMs,
			tokenUsage: result.tokenUsage,
			outputArtifactIds: [...result.savedFiles],
			provider: ctx.config.llm.provider,
			modelName: ctx.config.llm.model,
			costUsd: result.costUsd,
		});
		if (result.conversationLog && result.conversationLog.length > 0) {
			// Replace the streaming sidecar (which contains per-delta fragments)
			// with the clean final conversation built from agent.state.messages.
			// Dashboard continues reading the same file path; next poll picks up
			// the de-duplicated version instead of the partial deltas.
			try {
				const finalJsonl = result.conversationLog
					.map((entry) => JSON.stringify(entry))
					.join("\n");
				writeFileSync(sidecarPath, `${finalJsonl}\n`, "utf-8");
			} catch {
				// Best-effort — don't fail the run if sidecar overwrite fails
			}
			await ctx.store.saveConversationLog(agentRun.id, [
				...result.conversationLog,
			]);
		}
		metrics.recordAgentRun(
			agentRun.agentName,
			result.durationMs,
			{
				input: result.tokenUsage.inputTokens,
				output: result.tokenUsage.outputTokens,
			},
			"success",
		);
		metrics.recordRunCost(
			agentRun.agentName,
			ctx.config.llm.provider,
			ctx.config.llm.model,
			result.costUsd,
		);
		await ctx.controller.onAgentRunCompleted(agentRun.id, [
			...result.savedFiles,
		]);
		const successMsg = chalk.green(
			`  ${displayName} completed (${result.artifacts.length} artifacts)`,
		);
		if (spinner) {
			spinner.succeed(successMsg);
		} else {
			console.log(successMsg);
		}
		if (ctx.runSpan) endSpan(ctx.runSpan, "ok");
	} else {
		const errorMsg = result.error ?? "Unknown executor error";
		// Persist token/cost data even on failure so the dashboard can display it
		await ctx.store.updateAgentRun(agentRun.id, {
			durationMs: result.durationMs,
			tokenUsage: result.tokenUsage,
			provider: ctx.config.llm.provider,
			modelName: ctx.config.llm.model,
			costUsd: result.costUsd,
		});
		if (result.conversationLog && result.conversationLog.length > 0) {
			try {
				const finalJsonl = result.conversationLog
					.map((entry) => JSON.stringify(entry))
					.join("\n");
				writeFileSync(sidecarPath, `${finalJsonl}\n`, "utf-8");
			} catch {
				// Best-effort sidecar
			}
			await ctx.store.saveConversationLog(agentRun.id, [
				...result.conversationLog,
			]);
		}
		metrics.recordAgentRun(
			agentRun.agentName,
			result.durationMs,
			{
				input: result.tokenUsage.inputTokens,
				output: result.tokenUsage.outputTokens,
			},
			"error",
		);
		await ctx.controller.onAgentRunFailed(
			agentRun.id,
			errorMsg,
			result.exitReason,
		);
		const failMsg = chalk.red(`  ${displayName} failed: ${errorMsg}`);
		if (spinner) {
			spinner.fail(failMsg);
		} else {
			console.log(failMsg);
		}
		if (ctx.runSpan) endSpan(ctx.runSpan, "error", errorMsg);
	}
}

/** Convert phase input (string/string[]) to ArtifactData[] for AgentJob. */
function buildInputArtifacts(
	phaseInput: string | string[] | undefined,
): ArtifactData[] {
	if (!phaseInput) return [];
	if (typeof phaseInput === "string") {
		return [{ type: "other", path: "input.txt", content: phaseInput }];
	}
	return phaseInput.map((p, i) => ({
		type: "other" as const,
		path: `input-${i}.txt`,
		content: p,
	}));
}

/** Render phase input for the conversation sidecar's opening user entry. */
function stringifyInput(phaseInput: string | string[] | undefined): string {
	if (typeof phaseInput === "string") return phaseInput;
	if (Array.isArray(phaseInput)) return phaseInput.join(", ");
	return "(no input)";
}
