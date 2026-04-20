/**
 * Unified schema validation interface.
 * Wraps both Zod (built-in fallback) and ajv (JSON Schema from .agentforge/schemas/).
 * Consuming code never imports Zod or ajv directly for artifact validation.
 */

export interface ValidationResult {
	success: boolean;
	errors?: string[];
}

export interface SchemaValidator {
	validate(data: unknown): ValidationResult;
	readonly jsonSchema?: Record<string, unknown>;
}
