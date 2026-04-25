/**
 * Schema discovery engine — scans a directory for .schema.yaml and .schema.json
 * files, compiles them with ajv, and returns a Map of SchemaValidator instances.
 *
 * File naming convention: `<artifact-type>.schema.yaml` or `<artifact-type>.schema.json`
 * The artifact type is derived from the filename (e.g., `frd.schema.yaml` → `frd`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
// ajv is CJS; under NodeNext module resolution, use createRequire for clean interop.
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ValidateFunction } from "ajv";

const require = createRequire(import.meta.url);
const Ajv: new (opts: {
	allErrors: boolean;
}) => {
	compile(schema: Record<string, unknown>): ValidateFunction;
} = require("ajv");

import { parse as parseYaml } from "yaml";
import { AjvSchemaAdapter } from "./ajv-schema-adapter.js";
import type { SchemaValidator } from "./schema-validator.js";

const SCHEMA_YAML_SUFFIX = ".schema.yaml";
const SCHEMA_JSON_SUFFIX = ".schema.json";

/**
 * Compile in-memory schema bodies (e.g. hydrated from PG) into validators.
 * Same shape as `discoverSchemas()` but takes pre-loaded bodies instead of
 * scanning the filesystem. Used at boot and on the PG-mode refresh tick to
 * keep `setDiscoveredSchemas` aligned with the persisted state.
 */
export function buildSchemaValidators(
	schemas: ReadonlyArray<{ name: string; schema: Record<string, unknown> }>,
): Map<string, SchemaValidator> {
	const validators = new Map<string, SchemaValidator>();
	const ajv = new Ajv({ allErrors: true });
	for (const { name, schema } of schemas) {
		const body = { ...schema };
		// AJV 8 doesn't support draft 2020-12 $schema — strip before compilation.
		delete (body as Record<string, unknown>).$schema;
		const validateFn = ajv.compile(body);
		validators.set(name, new AjvSchemaAdapter(validateFn, body));
	}
	return validators;
}

export function discoverSchemas(
	schemasDir: string,
): Map<string, SchemaValidator> {
	const validators = new Map<string, SchemaValidator>();

	if (!existsSync(schemasDir)) {
		return validators;
	}

	const ajv = new Ajv({ allErrors: true });
	const files = readdirSync(schemasDir);

	for (const file of files) {
		let artifactType: string | null = null;
		let schemaObj: Record<string, unknown> | null = null;

		if (file.endsWith(SCHEMA_YAML_SUFFIX)) {
			artifactType = file.slice(0, -SCHEMA_YAML_SUFFIX.length);
			const raw = readFileSync(join(schemasDir, file), "utf-8");
			schemaObj = parseYaml(raw) as Record<string, unknown>;
		} else if (file.endsWith(SCHEMA_JSON_SUFFIX)) {
			artifactType = file.slice(0, -SCHEMA_JSON_SUFFIX.length);
			const raw = readFileSync(join(schemasDir, file), "utf-8");
			schemaObj = JSON.parse(raw) as Record<string, unknown>;
		}

		if (!artifactType || !schemaObj) continue;

		// AJV 8 doesn't support draft 2020-12 $schema — strip before compilation
		delete schemaObj.$schema;
		const validateFn = ajv.compile(schemaObj);
		validators.set(artifactType, new AjvSchemaAdapter(validateFn, schemaObj));
	}

	return validators;
}
