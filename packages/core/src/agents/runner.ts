/**
 * AgentRunner — orchestrates a single agent execution:
 *   load prompt -> build input -> call LLM -> validate -> save artifacts.
 */

import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
	type AgentDefinitionYaml,
	parseDefinitionFile,
} from "../definitions/parser.js";
import { resolveAgentforgeDir } from "../di/agentforge-dir.js";
import type { Container } from "../di/container.js";
import type { ArtifactData } from "../domain/models/artifact.model.js";
import type {
	AgentRunRequest,
	AgentRunResult,
	ConversationEntry,
} from "../domain/ports/execution-backend.port.js";
import {
	executeStepPipeline,
	type StepPipelineContext,
	type StepPipelineDef,
} from "../engine/step-pipeline.js";
import type { TemplateContext } from "../engine/template-vars.js";
import { getValidatorForType } from "../schemas/index.js";
import type { SchemaValidator } from "../schemas/schema-validator.js";
import {
	composeTimeoutSignal,
	isTimeoutAbortError,
} from "../utils/abort-signal.js";
import { getRuntimeDefinitionStore } from "./definition-source.js";
import { injectOutputSchemas } from "./prompt-schema-injector.js";
import { getAgentInfo } from "./registry.js";

/**
 * Thrown when an agent run exceeds its configured wall-clock timeout (P42, ADR-0003).
 * Callers can `instanceof AgentTimeoutError` to record `exitReason: "timeout"`
 * on the agent run record instead of a bare failure.
 */
export class AgentTimeoutError extends Error {
	readonly agentId: string;
	readonly timeoutSeconds: number;
	constructor(agentId: string, timeoutSeconds: number, message: string) {
		super(message);
		this.name = "AgentTimeoutError";
		this.agentId = agentId;
		this.timeoutSeconds = timeoutSeconds;
	}
}

export interface RunOptions {
	input?: string | string[];
	prompt?: string;
	outputDir?: string;
	/** AbortSignal threaded into the execution backend for cancellation. */
	signal?: AbortSignal;
}

export interface AgentRunOutput {
	artifacts: ArtifactData[];
	tokenUsage: { inputTokens: number; outputTokens: number };
	durationMs: number;
	savedFiles: string[];
	conversationLog?: ConversationEntry[];
}

export interface AgentRunner {
	run(options: RunOptions): Promise<AgentRunOutput>;
}

export function createAgent(
	agentId: string,
	container: Container,
): AgentRunner {
	const agentInfo = getAgentInfo(agentId);
	if (!agentInfo) {
		throw new Error(
			`Unknown agent: "${agentId}". Use 'sdlc-agent list' to see available agents.`,
		);
	}

	const logger = container.logger.child({ agent: agentId });

	return {
		async run(options: RunOptions): Promise<AgentRunOutput> {
			const startTime = Date.now();
			const outputDir = options.outputDir ?? container.config.outputDir;

			const definition = loadAgentDefinition(agentId);

			// 1. Load system prompt — inline text takes priority over file
			logger.info({}, "Loading system prompt");
			const inlineText = definition?.spec.systemPrompt.text;
			const rawPrompt = inlineText
				? inlineText
				: await container.promptLoader.load(agentId);
			const systemPrompt = definition?.spec.outputs
				? injectOutputSchemas(
						rawPrompt,
						definition.spec.outputs,
						getValidatorForType,
					)
				: rawPrompt;

			// 2. Build input artifacts
			const inputArtifacts = await buildInputArtifacts(options);

			// Wrap the user-provided abort signal with a wall-clock timeout so
			// a hung LLM stream can't burn arbitrary wall time (P42). Per-agent
			// YAML override wins over the global AGENTFORGE_LLM_TIMEOUT_SECONDS.
			// Default is 600s; set either to 0 to disable.
			const yamlTimeoutSeconds = definition?.spec.resources?.timeoutSeconds;
			const timeoutSeconds =
				yamlTimeoutSeconds !== undefined
					? yamlTimeoutSeconds
					: container.config.llm.timeoutSeconds;
			const timeoutSource =
				yamlTimeoutSeconds !== undefined
					? `spec.resources.timeoutSeconds in ${agentId}.agent.yaml`
					: "AGENTFORGE_LLM_TIMEOUT_SECONDS";
			const composed = composeTimeoutSignal({
				signal: options.signal,
				timeoutMs:
					timeoutSeconds && timeoutSeconds > 0
						? timeoutSeconds * 1000
						: undefined,
				timeoutReason: `LLM call for agent "${agentId}" timed out after ${timeoutSeconds}s (set ${timeoutSource} to override)`,
			});

			const agentRequest: AgentRunRequest = {
				agentId,
				systemPrompt,
				inputArtifacts,
				model: {
					provider: container.config.llm.provider,
					name: container.config.llm.model,
					maxTokens: container.config.llm.maxTokens,
				},
				tools: definition?.spec.tools,
				extensions: definition?.spec.extensions,
				signal: composed.signal,
				budget: definition?.spec.resources?.budget,
			};
			const hasPipeline =
				!!definition &&
				((definition.spec.steps?.length ?? 0) > 0 ||
					(definition.spec.flow?.length ?? 0) > 0);
			let result: NormalizedRunResult;
			try {
				result = hasPipeline
					? await runStepPipeline(
							definition as AgentDefinitionYaml,
							container,
							agentRequest,
							outputDir,
						)
					: await runSingleStep(container, agentRequest, logger);
			} catch (err) {
				if (composed.timedOut() || isTimeoutAbortError(err, composed)) {
					throw new AgentTimeoutError(
						agentId,
						timeoutSeconds ?? 0,
						`Agent "${agentId}" timed out after ${timeoutSeconds}s. Increase ${timeoutSource} or set to 0 to disable.`,
					);
				}
				throw err;
			} finally {
				composed.dispose();
			}

			for (const artifact of result.artifacts) {
				validateArtifact(artifact, logger);
			}

			const savedFiles: string[] = [];
			for (const artifact of result.artifacts) {
				logger.info({ path: artifact.path }, "Saving artifact");
				const saved = await container.artifactStore.save(artifact, outputDir);
				savedFiles.push(saved.absolutePath);
			}

			const durationMs = Date.now() - startTime;

			return {
				artifacts: [...result.artifacts],
				tokenUsage: { ...result.tokenUsage },
				durationMs,
				savedFiles,
				conversationLog: result.conversationLog
					? [...result.conversationLog]
					: undefined,
			};
		},
	};
}

interface NormalizedRunResult {
	artifacts: ArtifactData[];
	tokenUsage: { inputTokens: number; outputTokens: number };
	conversationLog?: ConversationEntry[];
}

async function runSingleStep(
	container: Container,
	agentRequest: AgentRunRequest,
	logger: { info: (ctx: Record<string, unknown>, msg: string) => void },
): Promise<NormalizedRunResult> {
	logger.info(
		{ inputCount: agentRequest.inputArtifacts.length },
		"Calling execution backend",
	);
	const result = await container.executionBackend.runAgent(agentRequest);
	ensureNoExecutionFailure(result);
	return {
		artifacts: [...result.artifacts],
		tokenUsage: { ...result.tokenUsage },
		conversationLog: result.conversationLog
			? [...result.conversationLog]
			: undefined,
	};
}

async function runStepPipeline(
	definition: AgentDefinitionYaml,
	container: Container,
	agentRequest: AgentRunRequest,
	workdir: string,
): Promise<NormalizedRunResult> {
	const pipeline: StepPipelineDef = {
		steps: (definition.spec.steps ?? []) as StepPipelineDef["steps"],
		definitions: definition.spec.definitions as StepPipelineDef["definitions"],
		flow: definition.spec.flow as StepPipelineDef["flow"],
	};
	const templateContext: TemplateContext = {
		run: {
			id: `${agentRequest.agentId}-${Date.now()}`,
			workdir,
			agent: agentRequest.agentId,
			phase: definition.metadata.phase,
			status: "running",
		},
		pipeline: {
			id: `${agentRequest.agentId}-pipeline`,
			name: definition.metadata.displayName ?? definition.metadata.name,
		},
		project: {
			name: definition.metadata.name,
			repo: "",
			repoPath: workdir,
		},
		steps: {},
		env: {},
	};
	const schemas = new Map<string, SchemaValidator>();
	const stepsForSchemas: Array<{ type: string; schema?: string }> = [
		...(pipeline.steps ?? []),
		...Object.values(pipeline.definitions ?? {}),
	];
	for (const step of stepsForSchemas) {
		if (step.type === "validate" && step.schema) {
			const validator = getValidatorForType(step.schema);
			if (validator) schemas.set(step.schema, validator);
		}
	}

	const context: StepPipelineContext = {
		templateContext,
		executionBackend: container.executionBackend,
		agentRunRequest: agentRequest,
		schemas,
		inputArtifacts: [...agentRequest.inputArtifacts],
	};
	const result = await executeStepPipeline(pipeline, context);
	if (result.status === "failed") {
		const failedStep = result.steps.find((step) => step.status === "failed");
		const err = new Error(
			`Step pipeline failed at ${failedStep?.name ?? "unknown step"}: ${failedStep?.error ?? "unknown error"}`,
		);
		// Attach partial results so the caller can persist token/cost data
		(err as Error & { partialResult?: NormalizedRunResult }).partialResult = {
			artifacts: [...result.artifacts],
			tokenUsage: result.tokenUsage,
			conversationLog: [...result.conversationLog],
		};
		throw err;
	}
	return {
		artifacts: [...result.artifacts],
		tokenUsage: result.tokenUsage,
		conversationLog: [...result.conversationLog],
	};
}

function loadAgentDefinition(agentId: string): AgentDefinitionYaml | null {
	// Prefer the runtime DefinitionStore (DB-backed in platform mode).
	// Fall back to filesystem for bare `agentforge-core` CLI runs.
	const runtime = getRuntimeDefinitionStore();
	if (runtime) {
		const def = runtime.getAgent(agentId);
		if (def) return def;
		// In platform mode, DB is the source of truth. Don't silently fall
		// through to filesystem — that just hides "applied? no, not really"
		// confusion. Return null so the caller surfaces "Unknown agent".
		return null;
	}
	try {
		const definition = parseDefinitionFile(
			join(resolveAgentforgeDir(), "agents", `${agentId}.agent.yaml`),
		);
		return definition.kind === "AgentDefinition" ? definition : null;
	} catch {
		return null;
	}
}

function ensureNoExecutionFailure(result: AgentRunResult): void {
	const errors = result.events.filter((e) => e.kind === "error");
	if (errors.length > 0) {
		const msg = errors
			.map((e) => {
				if ("message" in e && typeof e.message === "string") return e.message;
				return JSON.stringify(e);
			})
			.join("; ");
		throw new Error(`Agent execution failed: ${msg}`);
	}
}

async function buildInputArtifacts(
	options: RunOptions,
): Promise<ArtifactData[]> {
	const artifacts: ArtifactData[] = [];

	if (options.input) {
		const inputs = Array.isArray(options.input)
			? options.input
			: [options.input];

		for (const input of inputs) {
			const loaded = await loadInput(input);
			artifacts.push(...loaded);
		}
	}

	if (options.prompt) {
		artifacts.push({
			type: "prompt",
			path: "user-prompt.txt",
			content: options.prompt,
		});
	}

	return artifacts;
}

async function loadInput(input: string): Promise<ArtifactData[]> {
	// Check if it looks like a file path (contains path separator or common extensions)
	const ext = extname(input).toLowerCase();

	if (ext === ".json") {
		try {
			const raw = await readFile(input, "utf-8");
			const fileName = basename(input);
			const type = fileName.replace(/\.json$/, "");
			return [{ type, path: fileName, content: raw } as ArtifactData];
		} catch {
			// If file read fails, treat as inline string
			return [wrapAsRawInput(input)];
		}
	}

	if (ext === ".md" || ext === ".txt") {
		try {
			const content = await readFile(input, "utf-8");
			return [{ type: "other", path: input, content }];
		} catch {
			return [wrapAsRawInput(input)];
		}
	}

	// Try as directory
	try {
		const entries = await readdir(input);
		const jsonFiles = entries.filter(
			(f) => f.endsWith(".json") && f !== "_metadata.json",
		);
		const artifacts: ArtifactData[] = [];
		for (const file of jsonFiles) {
			const raw = await readFile(join(input, file), "utf-8");
			const type = file.replace(/\.json$/, "");
			artifacts.push({ type, path: file, content: raw } as ArtifactData);
		}
		if (artifacts.length > 0) return artifacts;
	} catch {
		// Not a directory — treat as inline string
	}

	return [wrapAsRawInput(input)];
}

function wrapAsRawInput(text: string): ArtifactData {
	return {
		type: "other",
		path: "inline-input.txt",
		content: text,
	};
}

function validateArtifact(
	artifact: ArtifactData,
	logger: { warn: (ctx: Record<string, unknown>, msg: string) => void },
): void {
	// Try to find a schema for this artifact's path stem (e.g., "frd" from "frd.json")
	const pathStem = artifact.path.replace(/\.\w+$/, "");
	const validator =
		getValidatorForType(pathStem) ?? getValidatorForType(artifact.type);

	if (!validator) return;

	try {
		const data = JSON.parse(artifact.content);
		const result = validator.validate(data);
		if (!result.success) {
			logger.warn(
				{ path: artifact.path, errors: result.errors },
				"Artifact failed schema validation",
			);
		}
	} catch {
		logger.warn(
			{ path: artifact.path },
			"Artifact content is not valid JSON, skipping schema validation",
		);
	}
}
