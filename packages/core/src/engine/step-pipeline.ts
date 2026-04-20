import type { ArtifactData } from "../domain/models/artifact.model.js";
import type {
	AgentRunRequest,
	ConversationEntry,
	IExecutionBackend,
	TokenUsage,
	TokenUsageExtra,
} from "../domain/ports/execution-backend.port.js";
import type {
	ISandbox,
	ISandboxProvider,
	SandboxOptions,
} from "../domain/ports/sandbox.port.js";
import {
	endSpan,
	startStepSpan,
	withSpanContext,
} from "../observability/spans.js";
import type { SchemaValidator } from "../schemas/schema-validator.js";
import { executeLlmStep, type LlmStepDef } from "./steps/llm-step.js";
import {
	executeScriptStep,
	type ScriptStepDef,
	type StepResult,
} from "./steps/script-step.js";
import {
	executeTransformStep,
	type TransformStepDef,
} from "./steps/transform-step.js";
import {
	executeValidateStep,
	type ValidateStepDef,
} from "./steps/validate-step.js";
import type { TemplateContext } from "./template-vars.js";
import { resolveTemplate } from "./template-vars.js";

export type AnyStepDef =
	| ScriptStepDef
	| LlmStepDef
	| ValidateStepDef
	| TransformStepDef;

// --- Flow model (ADR-0002 / P33) ---

export interface FlowStepRef {
	step: string;
	/** Optional condition evaluated at flow time, overrides the definition. */
	condition?: string;
}

export interface FlowParallel {
	parallel: FlowItem[];
}

export interface FlowLoop {
	loop: {
		until: string;
		maxIterations: number;
		do: FlowItem[];
	};
}

export type FlowItem = FlowStepRef | FlowParallel | FlowLoop;

export interface StepPipelineDef {
	/**
	 * Legacy flat steps array (backward compatible). Used when `flow` is absent.
	 */
	steps?: AnyStepDef[];
	/**
	 * Named step definitions, referenced by the `flow` array.
	 * The map key is the step name.
	 */
	definitions?: Record<string, Omit<AnyStepDef, "name"> & { name?: string }>;
	/**
	 * Execution flow — ordered sequence of step refs, parallel blocks, and loops.
	 * When present, takes precedence over `steps`.
	 */
	flow?: FlowItem[];
}

export interface StepPipelineContext {
	templateContext: TemplateContext;
	executionBackend: IExecutionBackend;
	agentRunRequest: AgentRunRequest;
	schemas: Map<string, SchemaValidator>;
	inputArtifacts: ArtifactData[];
	sandboxProvider?: ISandboxProvider;
	sandboxOptions?: SandboxOptions;
}

export interface StepPipelineResult {
	steps: StepResult[];
	status: "success" | "failed";
	artifacts: ArtifactData[];
	tokenUsage: TokenUsage;
	conversationLog: readonly ConversationEntry[];
}

export async function executeStepPipeline(
	pipeline: StepPipelineDef,
	context: StepPipelineContext,
): Promise<StepPipelineResult> {
	const results: StepResult[] = [];
	const artifacts: ArtifactData[] = [];
	let failed = false;

	let sandbox: ISandbox | undefined;
	if (context.sandboxProvider) {
		sandbox = await context.sandboxProvider.create(
			context.sandboxOptions ?? { image: "sdlc-agent-base:latest" },
		);
	}

	try {
		if (pipeline.flow && pipeline.flow.length > 0) {
			// New flow-based execution
			const definitions = buildDefinitionMap(pipeline);
			const outcome = await executeFlowItems(
				pipeline.flow,
				definitions,
				context,
				sandbox,
				artifacts,
				results,
			);
			failed = outcome.failed;
		} else {
			// Legacy flat-steps execution
			const steps = pipeline.steps ?? [];
			for (const step of steps) {
				const outcome = await runStepWithSpan(
					step,
					context,
					sandbox,
					artifacts,
				);
				results.push(outcome.result);
				if (outcome.failed) {
					failed = true;
					break;
				}
			}
		}

		type LlmLike = {
			tokenUsage?: TokenUsage;
			conversationLog?: readonly ConversationEntry[];
		};
		const tokenUsage = results.reduce<TokenUsage>(
			(acc, s) => {
				const usage = (s as LlmLike).tokenUsage;
				if (!usage) return acc;
				const mergedExtras = mergeExtras(acc.extras ?? [], usage.extras ?? []);
				return {
					inputTokens: acc.inputTokens + usage.inputTokens,
					outputTokens: acc.outputTokens + usage.outputTokens,
					...(mergedExtras.length > 0 ? { extras: mergedExtras } : {}),
				};
			},
			{ inputTokens: 0, outputTokens: 0 },
		);
		const conversationLog = results.flatMap(
			(s) => (s as LlmLike).conversationLog ?? [],
		);

		return {
			steps: results,
			status: failed ? "failed" : "success",
			artifacts,
			tokenUsage,
			conversationLog,
		};
	} finally {
		if (sandbox) {
			await sandbox.destroy();
		}
	}
}

// --- Flow executor ---

function buildDefinitionMap(
	pipeline: StepPipelineDef,
): Record<string, AnyStepDef> {
	const map: Record<string, AnyStepDef> = {};
	if (pipeline.definitions) {
		for (const [name, def] of Object.entries(pipeline.definitions)) {
			map[name] = { ...(def as AnyStepDef), name };
		}
	}
	// Also allow a legacy `steps:` array to serve as definitions by name, so
	// YAMLs can mix a flat list of named steps with a `flow:` that references them.
	if (pipeline.steps) {
		for (const step of pipeline.steps) {
			if (!(step.name in map)) {
				map[step.name] = step;
			}
		}
	}
	return map;
}

function resolveDefinition(
	name: string,
	definitions: Record<string, AnyStepDef>,
): AnyStepDef {
	const def = definitions[name];
	if (!def) {
		throw new Error(`Unknown flow step reference: '${name}'`);
	}
	return { ...def, name };
}

async function executeFlowItems(
	items: FlowItem[],
	definitions: Record<string, AnyStepDef>,
	context: StepPipelineContext,
	sandbox: ISandbox | undefined,
	artifacts: ArtifactData[],
	results: StepResult[],
): Promise<{ failed: boolean }> {
	for (const item of items) {
		if ("step" in item) {
			const baseDef = resolveDefinition(item.step, definitions);
			const step: AnyStepDef =
				item.condition !== undefined
					? ({ ...baseDef, condition: item.condition } as AnyStepDef)
					: baseDef;
			const outcome = await runStepWithSpan(step, context, sandbox, artifacts);
			results.push(outcome.result);
			if (outcome.failed) {
				return { failed: true };
			}
		} else if ("parallel" in item) {
			const failed = await executeParallelBlock(
				item.parallel,
				definitions,
				context,
				sandbox,
				artifacts,
				results,
			);
			if (failed) return { failed: true };
		} else if ("loop" in item) {
			const failed = await executeLoopBlock(
				item.loop,
				definitions,
				context,
				sandbox,
				artifacts,
				results,
			);
			if (failed) return { failed: true };
		}
	}
	return { failed: false };
}

async function executeParallelBlock(
	branches: FlowItem[],
	definitions: Record<string, AnyStepDef>,
	context: StepPipelineContext,
	sandbox: ISandbox | undefined,
	artifacts: ArtifactData[],
	results: StepResult[],
): Promise<boolean> {
	// Each branch collects its own local results; we merge in source order
	// after all branches settle so that a failing branch cannot strand the
	// pipeline waiting for its siblings (ADR-0002: "next flow item waits for
	// all branches"). We use allSettled because in-flight script/LLM steps
	// cannot truly be aborted — the practical contract is: wait for all,
	// then fail the block if any branch failed without continueOnError.
	const branchWork = branches.map(async (branch) => {
		const branchResults: StepResult[] = [];
		const outcome = await executeFlowItems(
			[branch],
			definitions,
			context,
			sandbox,
			artifacts,
			branchResults,
		);
		return { branchResults, failed: outcome.failed };
	});

	const settled = await Promise.allSettled(branchWork);
	let anyFailed = false;
	for (const entry of settled) {
		if (entry.status === "fulfilled") {
			results.push(...entry.value.branchResults);
			if (entry.value.failed) anyFailed = true;
		} else {
			anyFailed = true;
			results.push({
				name: "parallel-branch",
				type: "parallel",
				status: "failed",
				durationMs: 0,
				error:
					entry.reason instanceof Error
						? entry.reason.message
						: String(entry.reason),
			});
		}
	}
	return anyFailed;
}

/**
 * Build a step-specific LLM request by appending the step description and
 * prior step outputs as context. Without this, every LLM step would send
 * the same original agent request and produce identical results.
 */
function buildLlmStepRequest(
	step: LlmStepDef,
	baseRequest: AgentRunRequest,
	ctx: TemplateContext,
): AgentRunRequest {
	const rawInstructions = step.instructions ?? step.description;
	if (!rawInstructions) return baseRequest;

	const resolvedDescription = resolveTemplate(rawInstructions, ctx);

	// Build context from prior step outputs
	const priorOutputs: string[] = [];
	for (const [name, data] of Object.entries(ctx.steps)) {
		if (data.output) {
			priorOutputs.push(`--- ${name} output ---\n${data.output}`);
		}
	}

	const stepInstruction = [
		`## Current Step: ${step.name}`,
		resolvedDescription,
		...(priorOutputs.length > 0
			? ["\n## Prior Step Outputs", ...priorOutputs]
			: []),
	].join("\n\n");

	return {
		...baseRequest,
		inputArtifacts: [
			...baseRequest.inputArtifacts,
			{ type: "other", path: "step-instruction.md", content: stepInstruction },
		],
	};
}

async function executeLoopBlock(
	loop: FlowLoop["loop"],
	definitions: Record<string, AnyStepDef>,
	context: StepPipelineContext,
	sandbox: ISandbox | undefined,
	artifacts: ArtifactData[],
	results: StepResult[],
): Promise<boolean> {
	const savedLoop = context.templateContext.loop;
	try {
		for (let iteration = 1; iteration <= loop.maxIterations; iteration++) {
			context.templateContext.loop = {
				iteration,
				maxIterations: loop.maxIterations,
			};

			const outcome = await executeFlowItems(
				loop.do,
				definitions,
				context,
				sandbox,
				artifacts,
				results,
			);
			if (outcome.failed) {
				return true;
			}

			// Evaluate the `until` condition using the same semantics as the
			// existing `condition` field: the body repeats while the resolved
			// expression is "false" or the empty string. Any other value is
			// treated as truthy → exit the loop.
			const resolved = resolveTemplate(loop.until, context.templateContext);
			if (resolved !== "false" && resolved !== "") {
				return false;
			}

			if (iteration === loop.maxIterations) {
				results.push({
					name: "loop-max-iterations",
					type: "loop",
					status: "failed",
					durationMs: 0,
					error: `LOOP_MAX_ITERATIONS: 'until' condition "${loop.until}" not met after ${loop.maxIterations} iterations`,
				});
				return true;
			}
		}
		return false;
	} finally {
		if (savedLoop === undefined) {
			delete context.templateContext.loop;
		} else {
			context.templateContext.loop = savedLoop;
		}
	}
}

// --- Single step runner ---

interface StepOutcome {
	result: StepResult;
	failed: boolean;
}

async function runStepWithSpan(
	step: AnyStepDef,
	context: StepPipelineContext,
	sandbox: ISandbox | undefined,
	artifacts: ArtifactData[],
): Promise<StepOutcome> {
	// Check condition (applies to all step types)
	if ("condition" in step && step.condition !== undefined) {
		const resolved = resolveTemplate(step.condition, context.templateContext);
		if (resolved === "false" || resolved === "") {
			const skipped: StepResult = {
				name: step.name,
				type: step.type,
				status: "skipped",
				durationMs: 0,
			};
			context.templateContext.steps[step.name] = {
				output: undefined,
				exitCode: undefined,
			};
			return { result: skipped, failed: false };
		}
	}

	const stepSpan = startStepSpan({
		stepName: `agent.step ${step.type}:${step.name}`,
		stepType: step.type,
	});
	stepSpan.setAttribute("step.name", step.name);
	stepSpan.setAttribute("step.type", step.type);

	let result: StepResult;
	try {
		result = await withSpanContext(stepSpan, async () => {
			switch (step.type) {
				case "script": {
					if (sandbox) {
						return executeScriptStepInSandbox(
							step as ScriptStepDef,
							context.templateContext,
							sandbox,
						);
					}
					return executeScriptStep(
						step as ScriptStepDef,
						context.templateContext,
					);
				}
				case "llm": {
					const llmStep = step as LlmStepDef;
					// Build a step-specific request: append the step description
					// and prior step outputs so the LLM knows what task to perform.
					const stepRequest = buildLlmStepRequest(
						llmStep,
						context.agentRunRequest,
						context.templateContext,
					);
					const llmResult = await executeLlmStep(
						llmStep,
						context.executionBackend,
						stepRequest,
					);
					if (llmResult.artifacts) {
						artifacts.push(...(llmResult.artifacts as ArtifactData[]));
					}
					return llmResult;
				}
				case "validate": {
					const vstep = step as ValidateStepDef;
					const data = resolveStepInput(
						vstep.input,
						vstep.schema,
						context,
						artifacts,
					);
					return executeValidateStep(vstep, data, context.schemas);
				}
				case "transform": {
					const tstep = step as TransformStepDef;
					const input = resolveStepInput(
						tstep.input,
						undefined,
						context,
						artifacts,
					);
					return executeTransformStep(tstep, input);
				}
				default: {
					const unknownStep = step as AnyStepDef;
					return {
						name: unknownStep.name,
						type: unknownStep.type,
						status: "failed" as const,
						durationMs: 0,
						error: `Unknown step type: ${unknownStep.type}`,
					};
				}
			}
		});
	} catch (err) {
		endSpan(
			stepSpan,
			"error",
			err instanceof Error ? err.message : String(err),
		);
		throw err;
	}

	if (result.status === "failed") {
		stepSpan.setAttribute("step.error", result.error ?? "unknown");
		endSpan(stepSpan, "error", result.error);
	} else if (result.status === "skipped") {
		stepSpan.setAttribute("step.skipped", true);
		endSpan(stepSpan, "ok");
	} else {
		if (result.output) {
			stepSpan.setAttribute("step.output", result.output.slice(0, 4096));
		}
		endSpan(stepSpan, "ok");
	}

	// Update template context with step result. Re-executions (e.g. inside a
	// loop body) overwrite the previous value — last run wins (ADR-0002).
	context.templateContext.steps[step.name] = {
		output: result.output?.trim(),
		exitCode: result.exitCode,
	};

	let failed = false;
	if (result.status === "failed") {
		const continueOnError =
			"continueOnError" in step && step.continueOnError === true;
		if (!continueOnError) failed = true;
	}

	return { result, failed };
}

async function executeScriptStepInSandbox(
	step: ScriptStepDef,
	ctx: TemplateContext,
	sandbox: ISandbox,
): Promise<StepResult> {
	const start = Date.now();

	if (step.condition !== undefined) {
		const resolved = resolveTemplate(step.condition, ctx);
		if (resolved === "false" || resolved === "") {
			return {
				name: step.name,
				type: "script",
				status: "skipped",
				durationMs: 0,
			};
		}
	}

	const script = resolveTemplate(step.run ?? step.command ?? "", ctx);

	// Inject step outputs as env vars (mirrors executeScriptStep)
	const stepEnv: Record<string, string> = { ...(step.env ?? {}) };
	for (const [name, stepData] of Object.entries(ctx.steps)) {
		const envName = `STEP_${name.replace(/-/g, "_").toUpperCase()}_OUTPUT`;
		if (stepData.output != null) stepEnv[envName] = stepData.output;
	}

	const runResult = await sandbox.run(script, {
		cwd: step.workdir,
		env: stepEnv,
		timeout: step.timeout,
	});

	const durationMs = Date.now() - start;
	const output = runResult.stdout + (runResult.stderr ? runResult.stderr : "");

	if (runResult.exitCode !== 0) {
		return {
			name: step.name,
			type: "script",
			status: "failed",
			output,
			exitCode: runResult.exitCode,
			durationMs,
			error: `Command exited with code ${runResult.exitCode}`,
		};
	}

	return {
		name: step.name,
		type: "script",
		status: "success",
		output,
		exitCode: 0,
		durationMs,
	};
}

/** Merge two extras arrays by summing tokens for matching kinds. */
function mergeExtras(
	a: readonly TokenUsageExtra[],
	b: readonly TokenUsageExtra[],
): TokenUsageExtra[] {
	const map = new Map<string, TokenUsageExtra>();
	for (const e of [...a, ...b]) {
		const existing = map.get(e.kind);
		if (existing) {
			map.set(e.kind, { ...existing, tokens: existing.tokens + e.tokens });
		} else {
			map.set(e.kind, e);
		}
	}
	return [...map.values()];
}

function resolveStepInput(
	input: string | undefined,
	schemaName: string | undefined,
	context: StepPipelineContext,
	artifacts: ArtifactData[],
): string {
	if (input) {
		const directArtifact = context.inputArtifacts.find(
			(artifact) => artifact.type === input,
		);
		if (directArtifact) return directArtifact.content;

		const producedArtifact = artifacts.find(
			(artifact) => artifact.type === input,
		);
		if (producedArtifact) return producedArtifact.content;

		return resolveTemplate(input, context.templateContext);
	}

	if (schemaName) {
		const producedArtifact = artifacts.find(
			(artifact) => artifact.type === schemaName,
		);
		if (producedArtifact) return producedArtifact.content;

		const directArtifact = context.inputArtifacts.find(
			(artifact) => artifact.type === schemaName,
		);
		if (directArtifact) return directArtifact.content;
	}

	return "";
}
