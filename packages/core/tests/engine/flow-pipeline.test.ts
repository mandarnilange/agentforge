/**
 * Tests for the flow-based pipeline execution model (P33 / ADR-0002).
 *
 * Covers: definition resolution, backward-compat with `steps:` array,
 * parallel execution (wait-all + failure), loop `until` + maxIterations guard,
 * loop.iteration template variable, and steps.* context updates across
 * re-executions inside a loop.
 */

import { describe, expect, it, vi } from "vitest";
import type { ZodSchema } from "zod";
import type { AgentRunResult } from "../../src/domain/ports/execution-backend.port.js";
import {
	executeStepPipeline,
	type StepPipelineContext,
	type StepPipelineDef,
} from "../../src/engine/step-pipeline.js";

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
			pipeline: { id: "pipe-001", name: "test" },
			project: { name: "p", repo: "", repoPath: "" },
			steps: {},
			env: {},
		},
		executionBackend: {
			runAgent: vi.fn().mockResolvedValue({
				artifacts: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				durationMs: 0,
				events: [],
			} satisfies AgentRunResult),
		},
		agentRunRequest: {
			agentId: "developer",
			systemPrompt: "",
			inputArtifacts: [],
			model: { provider: "anthropic", name: "claude-sonnet-4", maxTokens: 100 },
		},
		schemas: new Map<string, ZodSchema>(),
		inputArtifacts: [],
		...overrides,
	};
}

describe("Flow pipeline — definitions resolution", () => {
	it("resolves a flow step ref to its definition and executes it", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				"run-tests": {
					type: "script",
					run: "echo tests-ran",
				},
			},
			flow: [{ step: "run-tests" }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0].name).toBe("run-tests");
		expect(result.steps[0].output?.trim()).toBe("tests-ran");
	});

	it("reuses a single definition across multiple flow positions", async () => {
		// In the flow array, the same step ref can appear twice — no
		// definition duplication required.
		const pipeline: StepPipelineDef = {
			definitions: {
				greet: { type: "script", run: "echo hello" },
			},
			flow: [{ step: "greet" }, { step: "greet" }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		expect(result.steps).toHaveLength(2);
		expect(result.steps[0].name).toBe("greet");
		expect(result.steps[1].name).toBe("greet");
	});

	it("throws on an unknown flow step ref", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				known: { type: "script", run: "echo hi" },
			},
			flow: [{ step: "unknown" }],
		};

		await expect(executeStepPipeline(pipeline, makeContext())).rejects.toThrow(
			/Unknown flow step reference/,
		);
	});

	it("honors a flow-level condition that overrides the definition", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				build: { type: "script", run: "echo built" },
			},
			flow: [{ step: "build", condition: "false" }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.steps[0].status).toBe("skipped");
	});
});

describe("Flow pipeline — backward compatibility", () => {
	it("executes a legacy `steps:` array when `flow:` is absent", async () => {
		const pipeline: StepPipelineDef = {
			steps: [
				{ name: "a", type: "script", run: "echo one" },
				{ name: "b", type: "script", run: "echo two" },
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		expect(result.steps.map((s) => s.name)).toEqual(["a", "b"]);
	});
});

describe("Flow pipeline — parallel block", () => {
	it("runs all branches concurrently and waits for all", async () => {
		const order: string[] = [];
		const makeScript = (tag: string) => ({
			type: "transform" as const,
			transformFn: () => {
				order.push(tag);
				return tag;
			},
		});

		const pipeline: StepPipelineDef = {
			definitions: {
				a: makeScript("a"),
				b: makeScript("b"),
				c: makeScript("c"),
			},
			flow: [{ parallel: [{ step: "a" }, { step: "b" }, { step: "c" }] }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		expect(result.steps).toHaveLength(3);
		expect(result.steps.map((s) => s.name).sort()).toEqual(["a", "b", "c"]);
		expect(order.sort()).toEqual(["a", "b", "c"]);
	});

	it("fails the block when any branch fails without continueOnError", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				good: { type: "script", run: "echo ok" },
				bad: { type: "script", run: "exit 1" },
			},
			flow: [{ parallel: [{ step: "good" }, { step: "bad" }] }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("failed");
		const bad = result.steps.find((s) => s.name === "bad");
		expect(bad?.status).toBe("failed");
	});

	it("tolerates a branch failure when continueOnError is set", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				good: { type: "script", run: "echo ok" },
				tolerant: {
					type: "script",
					run: "exit 1",
					continueOnError: true,
				},
			},
			flow: [
				{ parallel: [{ step: "good" }, { step: "tolerant" }] },
				{ step: "good" },
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		// The third run of `good` (after the parallel block) executes because
		// the parallel block's only failure was continueOnError-tagged.
		expect(result.steps).toHaveLength(3);
	});

	it("does not run subsequent flow items when a parallel branch fails", async () => {
		const afterMarker = vi.fn().mockReturnValue("after");
		const pipeline: StepPipelineDef = {
			definitions: {
				bad: { type: "script", run: "exit 1" },
				after: { type: "transform", transformFn: afterMarker },
			},
			flow: [{ parallel: [{ step: "bad" }] }, { step: "after" }],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("failed");
		expect(afterMarker).not.toHaveBeenCalled();
	});
});

describe("Flow pipeline — loop block", () => {
	it("exits the loop when the `until` condition becomes truthy", async () => {
		let count = 0;
		const pipeline: StepPipelineDef = {
			definitions: {
				gen: {
					type: "transform",
					transformFn: () => {
						count += 1;
						// Iterations 1–2 resolve to "false" (continue);
						// iteration 3 resolves to "true" (exit).
						return count < 3 ? "false" : "true";
					},
				},
			},
			flow: [
				{
					loop: {
						until: "{{steps.gen.output}}",
						maxIterations: 10,
						do: [{ step: "gen" }],
					},
				},
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		// Body runs 3 times before until becomes truthy.
		expect(result.steps).toHaveLength(3);
		expect(count).toBe(3);
	});

	it("runs the body at least once (do-while semantics)", async () => {
		let count = 0;
		const pipeline: StepPipelineDef = {
			definitions: {
				gen: {
					type: "transform",
					transformFn: () => {
						count += 1;
						return "already-true"; // truthy on first pass
					},
				},
			},
			flow: [
				{
					loop: {
						until: "{{steps.gen.output}}",
						maxIterations: 5,
						do: [{ step: "gen" }],
					},
				},
			],
		};

		await executeStepPipeline(pipeline, makeContext());
		expect(count).toBe(1);
	});

	it("fails with LOOP_MAX_ITERATIONS when the condition never holds", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				gen: { type: "transform", transformFn: () => "false" },
			},
			flow: [
				{
					loop: {
						until: "{{steps.gen.output}}",
						maxIterations: 2,
						do: [{ step: "gen" }],
					},
				},
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("failed");
		const maxErr = result.steps.find((s) => s.name === "loop-max-iterations");
		expect(maxErr?.status).toBe("failed");
		expect(maxErr?.error).toContain("LOOP_MAX_ITERATIONS");
		// Body executed maxIterations times.
		const genRuns = result.steps.filter((s) => s.name === "gen");
		expect(genRuns).toHaveLength(2);
	});

	it("exposes loop.iteration (1-based) inside the body", async () => {
		const seen: string[] = [];
		const pipeline: StepPipelineDef = {
			definitions: {
				probe: {
					type: "script",
					run: "echo iter-{{loop.iteration}}-of-{{loop.maxIterations}}",
				},
				signal: {
					type: "transform",
					transformFn: (_: string) => {
						// Always "false" so we exhaust iterations.
						return "false";
					},
				},
			},
			flow: [
				{
					loop: {
						until: "{{steps.signal.output}}",
						maxIterations: 3,
						do: [{ step: "probe" }, { step: "signal" }],
					},
				},
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("failed"); // LOOP_MAX_ITERATIONS
		for (const step of result.steps) {
			if (step.name === "probe" && step.output) {
				seen.push(step.output.trim());
			}
		}
		expect(seen).toEqual(["iter-1-of-3", "iter-2-of-3", "iter-3-of-3"]);
	});

	it("steps.* reflects the last execution of a named step across iterations", async () => {
		let count = 0;
		const pipeline: StepPipelineDef = {
			definitions: {
				gen: {
					type: "transform",
					transformFn: () => {
						count += 1;
						return String(count);
					},
				},
				stopper: {
					type: "transform",
					transformFn: () => (count >= 2 ? "done" : "false"),
				},
			},
			flow: [
				{
					loop: {
						until: "{{steps.stopper.output}}",
						maxIterations: 5,
						do: [{ step: "gen" }, { step: "stopper" }],
					},
				},
			],
		};

		const ctx = makeContext();
		const result = await executeStepPipeline(pipeline, ctx);
		expect(result.status).toBe("success");
		// The context should reflect the *last* run of `gen`.
		expect(ctx.templateContext.steps.gen?.output).toBe("2");
	});

	it("clears loop.* from template context after the loop exits", async () => {
		const pipeline: StepPipelineDef = {
			definitions: {
				gen: { type: "transform", transformFn: () => "true" },
			},
			flow: [
				{
					loop: {
						until: "{{steps.gen.output}}",
						maxIterations: 3,
						do: [{ step: "gen" }],
					},
				},
			],
		};

		const ctx = makeContext();
		await executeStepPipeline(pipeline, ctx);
		expect(ctx.templateContext.loop).toBeUndefined();
	});
});

describe("Flow pipeline — nested constructs", () => {
	it("supports parallel inside a loop body", async () => {
		let count = 0;
		const pipeline: StepPipelineDef = {
			definitions: {
				a: { type: "transform", transformFn: () => "a" },
				b: { type: "transform", transformFn: () => "b" },
				gate: {
					type: "transform",
					transformFn: () => {
						count += 1;
						return count < 2 ? "false" : "true";
					},
				},
			},
			flow: [
				{
					loop: {
						until: "{{steps.gate.output}}",
						maxIterations: 5,
						do: [
							{ parallel: [{ step: "a" }, { step: "b" }] },
							{ step: "gate" },
						],
					},
				},
			],
		};

		const result = await executeStepPipeline(pipeline, makeContext());
		expect(result.status).toBe("success");
		// 2 iterations × (a, b, gate) = 6 step results.
		expect(result.steps).toHaveLength(6);
	});
});
