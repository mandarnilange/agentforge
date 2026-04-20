/**
 * Wraps an ajv ValidateFunction as a SchemaValidator for JSON Schema
 * files discovered from .agentforge/schemas/.
 */

import type { ValidateFunction } from "ajv";
import type { SchemaValidator, ValidationResult } from "./schema-validator.js";

export class AjvSchemaAdapter implements SchemaValidator {
	readonly jsonSchema?: Record<string, unknown>;

	constructor(
		private readonly validateFn: ValidateFunction,
		jsonSchema?: Record<string, unknown>,
	) {
		this.jsonSchema = jsonSchema;
	}

	validate(data: unknown): ValidationResult {
		const valid = this.validateFn(data);
		if (valid) {
			return { success: true };
		}
		const errors = (this.validateFn.errors ?? []).map(
			(err) =>
				`${err.instancePath || "/"}${err.keyword === "required" ? `/${(err.params as { missingProperty?: string }).missingProperty ?? ""}` : ""}: ${err.message ?? "unknown error"}`,
		);
		return { success: false, errors };
	}
}
