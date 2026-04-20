import type { SchemaValidator } from "../../schemas/schema-validator.js";
import type { StepResult } from "./script-step.js";

export interface ValidateStepDef {
	name: string;
	type: "validate";
	schema: string;
	input?: string;
	description?: string;
	continueOnError?: boolean;
	condition?: string;
}

export async function executeValidateStep(
	step: ValidateStepDef,
	data: unknown,
	schemas: Map<string, SchemaValidator>,
): Promise<StepResult> {
	const start = Date.now();

	const validator = schemas.get(step.schema);
	if (!validator) {
		return {
			name: step.name,
			type: "validate",
			status: "failed",
			durationMs: Date.now() - start,
			error: `Schema "${step.schema}" not found`,
		};
	}

	if (data === "" || data === null || data === undefined) {
		return {
			name: step.name,
			type: "validate",
			status: "failed",
			durationMs: Date.now() - start,
			error: `No artifact found for schema "${step.schema}"`,
		};
	}

	try {
		const parsed = typeof data === "string" ? JSON.parse(data as string) : data;
		const result = validator.validate(parsed);

		if (result.success) {
			return {
				name: step.name,
				type: "validate",
				status: "success",
				output: "Validation passed",
				durationMs: Date.now() - start,
			};
		}

		return {
			name: step.name,
			type: "validate",
			status: "failed",
			durationMs: Date.now() - start,
			error: `Validation failed: ${(result.errors ?? []).join("; ")}`,
		};
	} catch (err) {
		return {
			name: step.name,
			type: "validate",
			status: "failed",
			durationMs: Date.now() - start,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
