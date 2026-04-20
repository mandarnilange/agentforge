import { execFile } from "node:child_process";
import { resolveTemplate, type TemplateContext } from "../template-vars.js";

export interface ScriptStepDef {
	name: string;
	type: "script";
	run?: string;
	command?: string;
	file?: string;
	env?: Record<string, string>;
	workdir?: string;
	timeout?: number;
	continueOnError?: boolean;
	captureOutput?: boolean;
	condition?: string;
	description?: string;
}

export interface StepResult {
	name: string;
	type: string;
	status: "success" | "failed" | "skipped";
	output?: string;
	exitCode?: number;
	durationMs: number;
	error?: string;
}

export async function executeScriptStep(
	step: ScriptStepDef,
	ctx: TemplateContext,
): Promise<StepResult> {
	const start = Date.now();

	if (step.condition !== undefined) {
		const resolved = resolveTemplate(step.condition, ctx);
		if (resolved === "false" || resolved === "") {
			return {
				name: step.name,
				type: "script",
				status: "skipped",
				durationMs: Date.now() - start,
			};
		}
	}

	const script = step.run ?? step.command ?? "";
	const resolvedScript = resolveTemplate(script, ctx);

	const env = step.env ? { ...process.env, ...step.env } : { ...process.env };

	// Inject step outputs as env vars so scripts can use $STEP_<NAME>_OUTPUT
	// instead of inline {{steps.name.output}} which breaks on special chars.
	for (const [name, stepData] of Object.entries(ctx.steps)) {
		const envName = `STEP_${name.replace(/-/g, "_").toUpperCase()}_OUTPUT`;
		if (stepData.output != null) env[envName] = stepData.output;
	}

	return new Promise<StepResult>((resolve) => {
		const _child = execFile(
			"/bin/sh",
			["-c", resolvedScript],
			{
				cwd: step.workdir,
				env,
				timeout: step.timeout ?? 60_000,
				maxBuffer: 10 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				const durationMs = Date.now() - start;
				const exitCode =
					error && "code" in error && typeof error.code === "number"
						? error.code
						: error
							? 1
							: 0;

				const output = stdout + (stderr ? stderr : "");

				if (error) {
					resolve({
						name: step.name,
						type: "script",
						status: "failed",
						output,
						exitCode,
						durationMs,
						error: error.message,
					});
				} else {
					resolve({
						name: step.name,
						type: "script",
						status: "success",
						output,
						exitCode: 0,
						durationMs,
					});
				}
			},
		);
	});
}
