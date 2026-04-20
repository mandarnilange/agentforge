import { describe, expect, it } from "vitest";
import {
	executeScriptStep,
	type ScriptStepDef,
} from "../../src/engine/steps/script-step.js";
import type { TemplateContext } from "../../src/engine/template-vars.js";

function makeCtx(
	steps: Record<string, { output?: string; exitCode?: number }> = {},
): TemplateContext {
	return { steps, env: {} };
}

describe("executeScriptStep", () => {
	it("injects step outputs as STEP_<NAME>_OUTPUT env vars", async () => {
		const step: ScriptStepDef = {
			name: "check",
			type: "script",
			run: 'echo "$STEP_SELF_REVIEW_OUTPUT"',
		};
		const ctx = makeCtx({
			"self-review": { output: "Score 9/10. APPROVE" },
		});
		const result = await executeScriptStep(step, ctx);
		expect(result.status).toBe("success");
		expect(result.output?.trim()).toBe("Score 9/10. APPROVE");
	});

	it("handles LLM output with special chars in env vars", async () => {
		const step: ScriptStepDef = {
			name: "gate",
			type: "script",
			run: `if echo "$STEP_REVIEW_OUTPUT" | grep -q "APPROVE"; then echo "PASS"; else echo "false"; fi`,
		};
		const ctx = makeCtx({
			review: {
				output: 'Quality: 9/10\n"Excellent work!" — APPROVE\nNo issues found.',
			},
		});
		const result = await executeScriptStep(step, ctx);
		expect(result.status).toBe("success");
		expect(result.output?.trim()).toBe("PASS");
	});

	it("env var is absent when step has no output", async () => {
		const step: ScriptStepDef = {
			name: "check",
			type: "script",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not JS template
			run: 'echo "${STEP_MISSING_OUTPUT:-none}"',
		};
		const ctx = makeCtx({});
		const result = await executeScriptStep(step, ctx);
		expect(result.status).toBe("success");
		expect(result.output?.trim()).toBe("none");
	});
});
