import type { StepResult } from "./script-step.js";

export interface TransformStepDef {
	name: string;
	type: "transform";
	transformFn?: (input: string) => string;
	file?: string;
	input?: string;
	description?: string;
	continueOnError?: boolean;
	condition?: string;
}

export async function executeTransformStep(
	step: TransformStepDef,
	input: string,
): Promise<StepResult> {
	const start = Date.now();

	try {
		if (!step.transformFn) {
			return {
				name: step.name,
				type: "transform",
				status: "failed",
				durationMs: Date.now() - start,
				error: "No transform function provided",
			};
		}

		const output = step.transformFn(input);
		return {
			name: step.name,
			type: "transform",
			status: "success",
			output,
			durationMs: Date.now() - start,
		};
	} catch (err) {
		return {
			name: step.name,
			type: "transform",
			status: "failed",
			durationMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
