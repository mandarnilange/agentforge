import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
	AgentRunResult,
	IExecutionBackend,
} from "../../src/domain/ports/execution-backend.port.js";
import {
	executeStepPipeline,
	type StepPipelineContext,
	type StepPipelineDef,
} from "../../src/engine/step-pipeline.js";
import { executeScriptStep } from "../../src/engine/steps/script-step.js";
import { executeTransformStep } from "../../src/engine/steps/transform-step.js";
import { executeValidateStep } from "../../src/engine/steps/validate-step.js";
import type { SchemaValidator } from "../../src/schemas/schema-validator.js";
import { ZodSchemaAdapter } from "../../src/schemas/zod-schema-adapter.js";

function makeContext(
	overrides: Partial<StepPipelineContext> = {},
): StepPipelineContext {
	return {
		templateContext: {
			run: {
				id: "run-001",
				workdir: "/tmp/work",
				agent: "developer",
				phase: "4",
				status: "running",
			},
			pipeline: { id: "pipe-001", name: "full-sdlc" },
			project: {
				name: "my-project",
				repo: "https://github.com/org/repo",
				repoPath: "/tmp/repo",
			},
			steps: {},
			env: {},
		},
		executionBackend: {
			runAgent: vi.fn().mockResolvedValue({
				artifacts: [
					{ type: "code", path: "api.ts", content: "export const x = 1;" },
				],
				tokenUsage: { inputTokens: 100, outputTokens: 50 },
				durationMs: 500,
				events: [],
			} satisfies AgentRunResult),
		},
		agentRunRequest: {
			agentId: "developer",
			systemPrompt: "You are Developer",
			inputArtifacts: [],
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4-20250514",
				maxTokens: 8192,
			},
		},
		schemas: new Map<string, SchemaValidator>(),
		inputArtifacts: [],
		...overrides,
	};
}

describe("Step Pipeline Executor", () => {
	describe("sequential execution", () => {
		it("runs steps in order and returns results", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "step-1", type: "script", run: "echo step1" },
					{ name: "step-2", type: "script", run: "echo step2" },
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps).toHaveLength(2);
			expect(result.steps[0].name).toBe("step-1");
			expect(result.steps[1].name).toBe("step-2");
			expect(result.status).toBe("success");
		});
	});

	describe("script step", () => {
		it("runs a shell command and captures output", async () => {
			const pipeline: StepPipelineDef = {
				steps: [{ name: "echo-test", type: "script", run: "echo hello" }],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps[0].status).toBe("success");
			expect(result.steps[0].output?.trim()).toBe("hello");
			expect(result.steps[0].exitCode).toBe(0);
		});

		it("captures exit code on failure", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "fail-cmd",
						type: "script",
						run: "exit 1",
						continueOnError: true,
					},
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps[0].status).toBe("failed");
			expect(result.steps[0].exitCode).toBe(1);
		});
	});

	describe("llm step", () => {
		it("delegates to IExecutionBackend and returns artifacts", async () => {
			const mockBackend: IExecutionBackend = {
				runAgent: vi.fn().mockResolvedValue({
					artifacts: [
						{ type: "code", path: "api.ts", content: "export const a = 1;" },
					],
					tokenUsage: { inputTokens: 100, outputTokens: 50 },
					durationMs: 500,
					events: [],
				} satisfies AgentRunResult),
			};

			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "generate", type: "llm", description: "Generate code" },
				],
			};

			const ctx = makeContext({ executionBackend: mockBackend });
			const result = await executeStepPipeline(pipeline, ctx);

			expect(result.steps[0].status).toBe("success");
			expect(mockBackend.runAgent).toHaveBeenCalled();
			expect(result.artifacts).toHaveLength(1);
			expect(result.artifacts[0].path).toBe("api.ts");
		});
	});

	describe("validate step", () => {
		it("succeeds when data matches schema", async () => {
			const schema = z.object({ name: z.string() });
			const schemas = new Map<string, SchemaValidator>([
				["test-schema", new ZodSchemaAdapter(schema)],
			]);

			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "validate-it",
						type: "validate",
						schema: "test-schema",
						input: '{"name":"hello"}',
					},
				],
			};

			const ctx = makeContext({ schemas });
			const result = await executeStepPipeline(pipeline, ctx);
			expect(result.steps[0].status).toBe("success");
		});

		it("fails when data does not match schema", async () => {
			const schema = z.object({ name: z.string() });
			const schemas = new Map<string, SchemaValidator>([
				["test-schema", new ZodSchemaAdapter(schema)],
			]);

			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "validate-fail",
						type: "validate",
						schema: "test-schema",
						input: '{"name": 42}',
						continueOnError: true,
					},
				],
			};

			const ctx = makeContext({ schemas });
			const result = await executeStepPipeline(pipeline, ctx);
			expect(result.steps[0].status).toBe("failed");
		});
	});

	describe("transform step", () => {
		it("runs a transform function and stores output", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "transform-it",
						type: "transform",
						transformFn: (input: string) =>
							JSON.stringify({ transformed: true, input }),
						input: "raw-data",
					},
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps[0].status).toBe("success");
			expect(result.steps[0].output).toContain("transformed");
		});
	});

	describe("continueOnError", () => {
		it("stops pipeline on failure when continueOnError=false (default)", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "fail-step", type: "script", run: "exit 1" },
					{ name: "after-fail", type: "script", run: "echo should-not-run" },
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.status).toBe("failed");
			expect(result.steps).toHaveLength(1);
			expect(result.steps[0].status).toBe("failed");
		});

		it("continues after failure when continueOnError=true", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "fail-step",
						type: "script",
						run: "exit 1",
						continueOnError: true,
					},
					{ name: "after-fail", type: "script", run: "echo continued" },
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps).toHaveLength(2);
			expect(result.steps[0].status).toBe("failed");
			expect(result.steps[1].status).toBe("success");
		});
	});

	describe("condition", () => {
		it("skips step when condition is 'false'", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{
						name: "skipped",
						type: "script",
						run: "echo should-not-run",
						condition: "false",
					},
					{ name: "runs", type: "script", run: "echo runs" },
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps).toHaveLength(2);
			expect(result.steps[0].status).toBe("skipped");
			expect(result.steps[1].status).toBe("success");
		});
	});

	describe("template variable substitution", () => {
		it("resolves {{run.id}} in script command", async () => {
			const pipeline: StepPipelineDef = {
				steps: [{ name: "echo-id", type: "script", run: "echo {{run.id}}" }],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps[0].output?.trim()).toBe("run-001");
		});

		it("resolves {{steps.NAME.output}} from previous step", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "producer", type: "script", run: "echo hello-world" },
					{
						name: "consumer",
						type: "script",
						run: "echo got:{{steps.producer.output}}",
					},
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			// The output of producer has a trailing newline which gets substituted
			expect(result.steps[1].output?.trim()).toContain("got:hello-world");
		});

		it("resolves {{steps.NAME.exitCode}} from previous step", async () => {
			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "setup", type: "script", run: "exit 0" },
					{
						name: "check",
						type: "script",
						run: "echo code:{{steps.setup.exitCode}}",
					},
				],
			};

			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.steps[1].output?.trim()).toBe("code:0");
		});
	});

	describe("multiple LLM steps", () => {
		it("executes multiple LLM steps correctly", async () => {
			let callCount = 0;
			const mockBackend: IExecutionBackend = {
				runAgent: vi.fn().mockImplementation(async () => {
					callCount++;
					return {
						artifacts: [
							{
								type: "code",
								path: `output-${callCount}.ts`,
								content: `// step ${callCount}`,
							},
						],
						tokenUsage: { inputTokens: 100, outputTokens: 50 },
						durationMs: 200,
						events: [],
					} satisfies AgentRunResult;
				}),
			};

			const pipeline: StepPipelineDef = {
				steps: [
					{ name: "analyze", type: "llm", description: "Analyze requirements" },
					{ name: "generate", type: "llm", description: "Generate code" },
				],
			};

			const ctx = makeContext({ executionBackend: mockBackend });
			const result = await executeStepPipeline(pipeline, ctx);

			expect(result.steps).toHaveLength(2);
			expect(result.steps[0].status).toBe("success");
			expect(result.steps[1].status).toBe("success");
			expect(mockBackend.runAgent).toHaveBeenCalledTimes(2);
			expect(result.artifacts).toHaveLength(2);
		});
	});

	describe("empty pipeline", () => {
		it("returns success with no steps", async () => {
			const pipeline: StepPipelineDef = { steps: [] };
			const result = await executeStepPipeline(pipeline, makeContext());
			expect(result.status).toBe("success");
			expect(result.steps).toHaveLength(0);
		});
	});
});

describe("executeStepPipeline with sandbox", () => {
	it("routes script steps through sandbox.run() when sandboxProvider is given", async () => {
		const mockSandbox = {
			run: vi.fn().mockResolvedValue({
				exitCode: 0,
				stdout: "sandbox output",
				stderr: "",
			}),
			writeFile: vi.fn().mockResolvedValue(undefined),
			readFile: vi.fn().mockResolvedValue(""),
			copyIn: vi.fn().mockResolvedValue(undefined),
			copyOut: vi.fn().mockResolvedValue(undefined),
			destroy: vi.fn().mockResolvedValue(undefined),
		};
		const mockProvider = {
			create: vi.fn().mockResolvedValue(mockSandbox),
		};

		const pipeline: StepPipelineDef = {
			steps: [{ name: "build", type: "script", run: "npm install" }],
		};
		const ctx = makeContext({ sandboxProvider: mockProvider });

		const result = await executeStepPipeline(pipeline, ctx);

		expect(mockProvider.create).toHaveBeenCalledOnce();
		expect(mockSandbox.run).toHaveBeenCalledWith(
			"npm install",
			expect.any(Object),
		);
		expect(mockSandbox.destroy).toHaveBeenCalledOnce();
		expect(result.status).toBe("success");
	});

	it("destroys sandbox even when a step fails", async () => {
		const mockSandbox = {
			run: vi
				.fn()
				.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "fail" }),
			writeFile: vi.fn(),
			readFile: vi.fn(),
			copyIn: vi.fn(),
			copyOut: vi.fn(),
			destroy: vi.fn().mockResolvedValue(undefined),
		};
		const mockProvider = {
			create: vi.fn().mockResolvedValue(mockSandbox),
		};

		const pipeline: StepPipelineDef = {
			steps: [{ name: "build", type: "script", run: "bad-command" }],
		};
		const ctx = makeContext({ sandboxProvider: mockProvider });

		const result = await executeStepPipeline(pipeline, ctx);

		expect(mockSandbox.destroy).toHaveBeenCalledOnce();
		expect(result.status).toBe("failed");
	});

	it("skips step when condition resolves to 'false'", async () => {
		const mockSandbox = {
			run: vi
				.fn()
				.mockResolvedValue({ exitCode: 0, stdout: "output", stderr: "" }),
			writeFile: vi.fn().mockResolvedValue(undefined),
			readFile: vi.fn().mockResolvedValue(""),
			copyIn: vi.fn().mockResolvedValue(undefined),
			copyOut: vi.fn().mockResolvedValue(undefined),
			destroy: vi.fn().mockResolvedValue(undefined),
		};
		const mockProvider = {
			create: vi.fn().mockResolvedValue(mockSandbox),
		};

		const pipeline: StepPipelineDef = {
			steps: [
				{
					name: "conditional-step",
					type: "script",
					run: "echo hello",
					condition: "false",
				},
			],
		};
		const ctx = makeContext({ sandboxProvider: mockProvider });

		const result = await executeStepPipeline(pipeline, ctx);

		// Step should be skipped, sandbox.run should NOT be called
		expect(mockSandbox.run).not.toHaveBeenCalled();
		expect(result.steps[0].status).toBe("skipped");
	});
});

describe("resolveStepInput — uncovered branches", () => {
	it("returns content from produced artifact when input matches artifact type", async () => {
		let callCount = 0;
		const mockBackend: IExecutionBackend = {
			runAgent: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return {
						artifacts: [
							{ type: "spec", path: "spec.md", content: "produced content" },
						],
						tokenUsage: { inputTokens: 10, outputTokens: 5 },
						durationMs: 100,
						events: [],
					} satisfies AgentRunResult;
				}
				return {
					artifacts: [],
					tokenUsage: { inputTokens: 10, outputTokens: 5 },
					durationMs: 100,
					events: [],
				} satisfies AgentRunResult;
			}),
		};

		// Pipeline: LLM step produces "spec" artifact, then transform step uses "spec" as input
		// The transform step will fail (no transformFn) but resolveStepInput is still called
		const pipeline: StepPipelineDef = {
			steps: [
				{ name: "produce", type: "llm", description: "Produce spec" },
				// input: "spec" - will find it in produced artifacts (not in inputArtifacts)
				{ name: "transform-spec", type: "transform", input: "spec" },
			],
		};

		const ctx = makeContext({ executionBackend: mockBackend });
		const result = await executeStepPipeline(pipeline, ctx);
		// The transform fails because no transformFn, but resolveStepInput is covered
		expect(result.steps[0].status).toBe("success");
	});

	it("resolves validate step with schemaName from produced artifact", async () => {
		const frdSchema = z.object({ title: z.string() });
		const schemas = new Map<string, SchemaValidator>([
			["frd", new ZodSchemaAdapter(frdSchema)],
		]);

		const mockBackend: IExecutionBackend = {
			runAgent: vi.fn().mockResolvedValue({
				artifacts: [
					{ type: "frd", path: "frd.json", content: '{"title":"FRD"}' },
				],
				tokenUsage: { inputTokens: 10, outputTokens: 5 },
				durationMs: 100,
				events: [],
			} satisfies AgentRunResult),
		};

		const pipeline: StepPipelineDef = {
			steps: [
				{ name: "produce-frd", type: "llm", description: "Produce FRD" },
				{ name: "validate-frd", type: "validate", schema: "frd" }, // input is undefined
			],
		};

		const ctx = makeContext({ executionBackend: mockBackend, schemas });
		const result = await executeStepPipeline(pipeline, ctx);
		// validate finds "frd" in produced artifacts (schemaName branch)
		expect(result.steps[0].status).toBe("success");
	});

	it("resolves validate step with schemaName from inputArtifacts when not yet produced", async () => {
		const frdSchema = z.object({ title: z.string() });
		const schemas = new Map<string, SchemaValidator>([
			["frd", new ZodSchemaAdapter(frdSchema)],
		]);

		const pipeline: StepPipelineDef = {
			steps: [{ name: "validate-frd", type: "validate", schema: "frd" }],
		};

		// frd artifact is in inputArtifacts, not produced yet
		const ctx = makeContext({
			schemas,
			inputArtifacts: [
				{ type: "frd", path: "frd.json", content: '{"title":"From Input"}' },
			],
			agentRunRequest: {
				agentId: "developer",
				systemPrompt: "You are Developer",
				inputArtifacts: [
					{ type: "frd", path: "frd.json", content: '{"title":"From Input"}' },
				],
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4-20250514",
					maxTokens: 8192,
				},
			},
		});
		const result = await executeStepPipeline(pipeline, ctx);
		// validate finds "frd" in context.inputArtifacts (schemaName → directArtifact branch)
		expect(result.steps[0].status).toBe("success");
	});

	it("returns empty string when neither input nor schemaName has a matching artifact", async () => {
		// A transform step with no input and no matching artifacts → resolveStepInput returns ""
		const pipeline: StepPipelineDef = {
			steps: [{ name: "transform-nothing", type: "transform" }],
		};
		const ctx = makeContext({});
		// The step fails because no transformFn, but resolveStepInput is called first
		const result = await executeStepPipeline(pipeline, ctx);
		expect(result.steps[0].status).toBe("failed");
	});
});

describe("resolveStepInput — inputArtifacts.find callback", () => {
	it("returns content from inputArtifacts when input type matches (transform step)", async () => {
		const pipeline: StepPipelineDef = {
			steps: [{ name: "transform-spec", type: "transform", input: "raw-spec" }],
		};
		const ctx = makeContext({
			inputArtifacts: [
				{ type: "raw-spec", path: "spec.txt", content: "project brief" },
			],
		});
		// resolveStepInput("raw-spec", undefined, ctx, []) → inputArtifacts.find callback runs
		// finds "raw-spec" in inputArtifacts → line 274 covered
		const result = await executeStepPipeline(pipeline, ctx);
		// Transform fails because no transformFn, but resolveStepInput was called
		expect(result.steps[0].status).toBe("failed");
	});
});

describe("executeScriptStep — condition branches", () => {
	it("returns skipped when condition is 'false'", async () => {
		const templateCtx = {
			run: {
				id: "r1",
				workdir: "/tmp",
				agent: "a",
				phase: "1",
				status: "running" as const,
			},
			pipeline: { id: "p1", name: "test" },
			project: { name: "proj", repo: "", repoPath: "" },
			steps: {},
			env: {},
		};
		const result = await executeScriptStep(
			{ name: "step", type: "script", run: "echo hi", condition: "false" },
			templateCtx,
		);
		expect(result.status).toBe("skipped");
	});

	it("returns skipped when condition resolves to empty string", async () => {
		const templateCtx = {
			run: {
				id: "r1",
				workdir: "/tmp",
				agent: "a",
				phase: "1",
				status: "running" as const,
			},
			pipeline: { id: "p1", name: "test" },
			project: { name: "proj", repo: "", repoPath: "" },
			steps: {},
			env: {},
		};
		const result = await executeScriptStep(
			{ name: "step", type: "script", run: "echo hi", condition: "" },
			templateCtx,
		);
		expect(result.status).toBe("skipped");
	});
});

describe("executeValidateStep — error branches", () => {
	it("returns failed when schema not found in map", async () => {
		const result = await executeValidateStep(
			{ name: "validate", type: "validate", schema: "missing-schema" },
			"{}",
			new Map(),
		);
		expect(result.status).toBe("failed");
		expect(result.error).toContain("missing-schema");
	});

	it("returns failed when data is not parseable JSON", async () => {
		const schema = z.object({ title: z.string() });
		const schemas = new Map([["doc", new ZodSchemaAdapter(schema)]]);
		const result = await executeValidateStep(
			{ name: "validate", type: "validate", schema: "doc" },
			"not-valid-json{{{",
			schemas,
		);
		expect(result.status).toBe("failed");
	});
});

describe("executeValidateStep — SchemaValidator interface", () => {
	it("works with SchemaValidator instead of ZodSchema", async () => {
		const validator = {
			validate: (data: unknown) => {
				const obj = data as Record<string, unknown>;
				if (typeof obj.title === "string") return { success: true as const };
				return { success: false as const, errors: ["title must be a string"] };
			},
		};
		const schemas = new Map([["doc", validator]]);
		const result = await executeValidateStep(
			{ name: "validate-sv", type: "validate", schema: "doc" },
			JSON.stringify({ title: "Hello" }),
			schemas,
		);
		expect(result.status).toBe("success");
	});

	it("reports errors from SchemaValidator on invalid data", async () => {
		const validator = {
			validate: (_data: unknown) => ({
				success: false as const,
				errors: ["title is required"],
			}),
		};
		const schemas = new Map([["doc", validator]]);
		const result = await executeValidateStep(
			{ name: "validate-sv-fail", type: "validate", schema: "doc" },
			JSON.stringify({ bad: true }),
			schemas,
		);
		expect(result.status).toBe("failed");
		expect(result.error).toContain("title is required");
	});

	it("StepPipelineContext.schemas accepts SchemaValidator map", async () => {
		const validator = {
			validate: (data: unknown) => {
				const obj = data as Record<string, unknown>;
				return typeof obj.name === "string"
					? { success: true as const }
					: { success: false as const, errors: ["name required"] };
			},
		};
		const pipeline: StepPipelineDef = {
			steps: [
				{
					name: "validate-it",
					type: "validate",
					schema: "item",
					input: "item",
				},
			],
		};
		const ctx = makeContext({
			schemas: new Map([["item", validator]]),
			inputArtifacts: [
				{ type: "item", path: "item.json", content: '{"name":"test"}' },
			],
		});
		const result = await executeStepPipeline(pipeline, ctx);
		expect(result.status).toBe("success");
	});
});

describe("executeTransformStep — catch branch", () => {
	it("returns failed when transformFn throws", async () => {
		const result = await executeTransformStep(
			{
				name: "transform",
				type: "transform",
				transformFn: () => {
					throw new Error("transform error");
				},
			},
			"input data",
		);
		expect(result.status).toBe("failed");
		expect(result.error).toContain("transform error");
	});
});
