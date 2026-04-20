import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// --- Step / Flow schemas (shared by AgentDefinition) ---

const StepDefinitionSchema = z.object({
	type: z.enum(["script", "llm", "validate", "transform"]),
	name: z.string().optional(),
	run: z.string().optional(),
	file: z.string().optional(),
	command: z.string().optional(),
	schema: z.string().optional(),
	input: z.string().optional(),
	description: z.string().optional(),
	continueOnError: z.boolean().optional(),
	condition: z.string().optional(),
	captureOutput: z.boolean().optional(),
});

const StepDefinitionWithNameSchema = StepDefinitionSchema.extend({
	name: z.string(),
});

export type StepConfigYaml = z.infer<typeof StepDefinitionSchema>;

// Flow items are recursive: step refs, parallel blocks, loop blocks.
// We define the Zod schema with a manual type to get proper inference
// through the recursion (z.lazy erases type info otherwise).
export type FlowItemZ =
	| { step: string; condition?: string }
	| { parallel: FlowItemZ[] }
	| { loop: { until: string; maxIterations: number; do: FlowItemZ[] } };

const FlowStepRefSchema: z.ZodType<{ step: string; condition?: string }> =
	z.object({
		step: z.string(),
		condition: z.string().optional(),
	});

const FlowItemSchema: z.ZodType<FlowItemZ> = z.lazy(() =>
	z.union([
		FlowStepRefSchema,
		z.object({ parallel: z.array(FlowItemSchema) }),
		z.object({
			loop: z.object({
				until: z.string(),
				maxIterations: z.number().int().positive(),
				do: z.array(FlowItemSchema),
			}),
		}),
	]),
);

// --- Agent Definition Schema ---

export const AgentDefinitionSchema = z
	.object({
		apiVersion: z.string(),
		kind: z.literal("AgentDefinition"),
		metadata: z.object({
			name: z.string(),
			displayName: z.string().optional(),
			description: z.string().optional(),
			phase: z.string(),
			role: z.string().optional(),
			humanEquivalent: z.string().optional(),
		}),
		spec: z.object({
			executor: z.enum(["pi-ai", "pi-coding-agent"]),
			model: z
				.object({
					provider: z.string(),
					name: z.string(),
					maxTokens: z.number().optional(),
					thinking: z.string().optional(),
				})
				.optional(),
			systemPrompt: z.object({
				file: z.string().optional(),
				text: z.string().min(1).optional(),
			}),
			tools: z.array(z.string()).optional(),
			extensions: z.array(z.string()).optional(),
			inputs: z
				.array(
					z.object({
						type: z.string(),
						from: z.string().optional(),
						required: z.boolean().optional(),
					}),
				)
				.optional(),
			outputs: z.array(
				z.object({
					type: z.string(),
					schema: z.string().optional(),
				}),
			),
			nodeAffinity: z
				.object({
					required: z.array(z.object({ capability: z.string() })).optional(),
					preferred: z.array(z.object({ capability: z.string() })).optional(),
				})
				.optional(),
			resources: z
				.object({
					budget: z
						.object({
							maxTotalTokens: z.number().positive().optional(),
							maxCostUsd: z.number().positive().optional(),
						})
						.optional(),
					/**
					 * Wall-clock timeout for this agent's LLM call (seconds).
					 * Overrides AGENTFORGE_LLM_TIMEOUT_SECONDS for this agent only.
					 * Set to 0 to disable timeout for this agent.
					 */
					timeoutSeconds: z.number().int().nonnegative().optional(),
				})
				.optional(),
			sandbox: z
				.object({
					image: z.string().optional(),
					memory: z.string().optional(),
					cpu: z.number().optional(),
					network: z.boolean().optional(),
					timeout: z.string().optional(),
				})
				.optional(),
			steps: z.array(StepDefinitionWithNameSchema).optional(),
			definitions: z.record(z.string(), StepDefinitionSchema).optional(),
			flow: z.array(FlowItemSchema).optional(),
		}),
	})
	.superRefine((data, ctx) => {
		// Validate systemPrompt: exactly one of file or text
		const hasFile = !!data.spec.systemPrompt.file;
		const hasText = !!data.spec.systemPrompt.text;
		if (hasFile && hasText) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["spec", "systemPrompt"],
				message: "systemPrompt must have either 'file' or 'text', not both",
			});
		}
		if (!hasFile && !hasText) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["spec", "systemPrompt"],
				message: "systemPrompt must have either 'file' or 'text'",
			});
		}

		const flow = data.spec.flow;
		if (!flow || flow.length === 0) return;
		const definitions = data.spec.definitions ?? {};
		const walk = (items: FlowItemZ[], path: (string | number)[]): void => {
			items.forEach((item, idx) => {
				const itemPath = [...path, idx];
				if ("step" in item) {
					if (!(item.step in definitions)) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							path: ["spec", "flow", ...itemPath, "step"],
							message: `Flow step reference '${item.step}' is not defined in spec.definitions`,
						});
					}
				} else if ("parallel" in item) {
					walk(item.parallel, [...itemPath, "parallel"]);
				} else if ("loop" in item) {
					walk(item.loop.do, [...itemPath, "loop", "do"]);
				}
			});
		};
		walk(flow, []);
	});

export type AgentDefinitionYaml = z.infer<typeof AgentDefinitionSchema>;

// --- Pipeline Definition Schema ---

const PipelinePhaseSchema = z.object({
	name: z.string(),
	phase: z.number(),
	agents: z.array(z.string()),
	parallel: z.boolean().optional(),
	gate: z
		.object({
			required: z.boolean().optional(),
			waitForAll: z.boolean().optional(),
			approvers: z
				.object({
					minCount: z.number().optional(),
					roles: z.array(z.string()).optional(),
				})
				.optional(),
		})
		.optional(),
	crossCutting: z.array(z.string()).optional(),
});

export const PipelineDefinitionSchema = z.object({
	apiVersion: z.string(),
	kind: z.literal("PipelineDefinition"),
	metadata: z.object({
		name: z.string(),
		displayName: z.string().optional(),
		description: z.string().optional(),
	}),
	spec: z.object({
		input: z
			.array(
				z.object({
					name: z.string(),
					type: z.string(),
					description: z.string().optional(),
					required: z.boolean().optional(),
				}),
			)
			.optional(),
		repository: z
			.object({
				mode: z.string().optional(),
			})
			.optional(),
		phases: z.array(PipelinePhaseSchema),
		wiring: z.record(z.string(), z.record(z.string(), z.string())).optional(),
		crossCuttingAgents: z.record(z.string(), z.any()).optional(),
		gateDefaults: z
			.object({
				actions: z.array(z.string()).optional(),
				timeout: z.string().optional(),
			})
			.optional(),
		retryPolicy: z
			.object({
				maxRetries: z.number().optional(),
				backoff: z.string().optional(),
				initialDelay: z.string().optional(),
			})
			.optional(),
		limits: z
			.object({
				maxTokens: z.number().optional(),
				maxCostUsd: z.number().optional(),
				maxConcurrentRuns: z.number().optional(),
			})
			.optional(),
	}),
});

export type PipelineDefinitionYaml = z.infer<typeof PipelineDefinitionSchema>;

// --- Node Definition Schema ---
// Defined in the domain layer; re-exported here for backward compat.
import {
	NodeDefinitionSchema,
	type NodeDefinitionYaml,
} from "../domain/models/node-definition.model.js";

export { NodeDefinitionSchema, type NodeDefinitionYaml };

// --- Generic parsed definition (union) ---

export type ParsedDefinition =
	| AgentDefinitionYaml
	| PipelineDefinitionYaml
	| NodeDefinitionYaml;

// --- Parser functions ---

export function parseAgentDefinition(yamlContent: string): AgentDefinitionYaml {
	const raw = parseYaml(yamlContent);
	return AgentDefinitionSchema.parse(raw);
}

export function parsePipelineDefinition(
	yamlContent: string,
): PipelineDefinitionYaml {
	const raw = parseYaml(yamlContent);
	return PipelineDefinitionSchema.parse(raw);
}

export function parseNodeDefinition(yamlContent: string): NodeDefinitionYaml {
	const raw = parseYaml(yamlContent);
	return NodeDefinitionSchema.parse(raw);
}

export function parseDefinitionFile(filePath: string): ParsedDefinition {
	const content = readFileSync(filePath, "utf-8");
	const raw = parseYaml(content);

	if (!raw || typeof raw !== "object" || !("kind" in raw)) {
		throw new Error(
			`Invalid definition file: missing 'kind' field in ${filePath}`,
		);
	}

	switch (raw.kind) {
		case "AgentDefinition":
			return AgentDefinitionSchema.parse(raw);
		case "PipelineDefinition":
			return PipelineDefinitionSchema.parse(raw);
		case "NodeDefinition":
			return NodeDefinitionSchema.parse(raw);
		default:
			throw new Error(
				`Unsupported definition kind: ${raw.kind} in ${filePath}`,
			);
	}
}

export interface LoadedDefinitions {
	agents: AgentDefinitionYaml[];
	pipelines: PipelineDefinitionYaml[];
	nodes: NodeDefinitionYaml[];
}

export function loadDefinitionsFromDir(dir: string): LoadedDefinitions {
	const result: LoadedDefinitions = {
		agents: [],
		pipelines: [],
		nodes: [],
	};

	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".yaml") || f.endsWith(".yml"),
	);

	for (const file of files) {
		const filePath = join(dir, file);
		const def = parseDefinitionFile(filePath);

		switch (def.kind) {
			case "AgentDefinition":
				result.agents.push(def);
				break;
			case "PipelineDefinition":
				result.pipelines.push(def);
				break;
			case "NodeDefinition":
				result.nodes.push(def);
				break;
		}
	}

	return result;
}
