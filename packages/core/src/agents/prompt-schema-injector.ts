import type { SchemaValidator } from "../schemas/schema-validator.js";

interface OutputDef {
	type: string;
	schema?: string;
}

/**
 * Builds the top-level JSON envelope showing which artifact keys the agent
 * must produce. Derived from definition.spec.outputs so it stays in sync.
 */
export function buildOutputEnvelope(types: string[]): string {
	const artifacts: Record<string, string> = {};
	for (const t of types) {
		artifacts[t] = "{ ... }";
	}
	return JSON.stringify({ artifacts }, null, 2);
}

/**
 * Replaces the `{{output_schemas}}` placeholder in a system prompt with a
 * dynamically-generated section containing:
 *  1. The output envelope (which artifact keys to produce)
 *  2. The JSON Schema for each output type
 *
 * If no placeholder is present, the prompt is returned unchanged.
 */
export function injectOutputSchemas(
	prompt: string,
	outputs: OutputDef[],
	getValidator: (type: string) => SchemaValidator | undefined,
): string {
	if (!prompt.includes("{{output_schemas}}")) return prompt;

	const lines: string[] = [];

	// Collect only outputs that have a JSON schema
	const schemasWithDefs: Array<{
		type: string;
		schema: Record<string, unknown>;
	}> = [];
	for (const output of outputs) {
		const validator = getValidator(output.type);
		if (!validator?.jsonSchema) continue;
		schemasWithDefs.push({ type: output.type, schema: validator.jsonSchema });
	}

	// 1. Output format envelope — only types with known schemas
	const types = schemasWithDefs.map((s) => s.type);
	lines.push("## Output Format");
	lines.push("");
	lines.push(
		"Your output MUST be a single valid JSON object with this structure. Do not wrap it in markdown code fences. Produce ONLY the JSON.",
	);
	lines.push("");
	lines.push("```json");
	lines.push(buildOutputEnvelope(types));
	lines.push("```");
	lines.push("");
	lines.push("---");
	lines.push("");

	// 2. Per-artifact schemas
	if (schemasWithDefs.length > 0) {
		lines.push("## Artifact Schemas");
		lines.push("");
		lines.push("Each artifact must conform to its JSON Schema below.");
		lines.push("");

		for (const { type, schema } of schemasWithDefs) {
			lines.push(`### \`${type}\``);
			if (schema.description) {
				lines.push("");
				lines.push(String(schema.description));
			}
			lines.push("");
			lines.push("```json");
			lines.push(JSON.stringify(schema, null, 2));
			lines.push("```");
			lines.push("");
		}
	}

	const section = lines.join("\n").trimEnd();
	return prompt.replace("{{output_schemas}}", section);
}
