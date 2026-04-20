/**
 * Wraps an existing ZodSchema as a SchemaValidator so the built-in
 * Zod registry can be consumed through the unified interface.
 */

import type { ZodType } from "zod";
import type { SchemaValidator, ValidationResult } from "./schema-validator.js";

export class ZodSchemaAdapter implements SchemaValidator {
	constructor(private readonly schema: ZodType) {}

	validate(data: unknown): ValidationResult {
		const result = this.schema.safeParse(data);
		if (result.success) {
			return { success: true };
		}
		const errors = result.error.issues.map(
			(issue) => `${issue.path.join(".")}: ${issue.message}`,
		);
		return { success: false, errors };
	}
}
