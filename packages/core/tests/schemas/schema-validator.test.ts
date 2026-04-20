import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { AjvSchemaAdapter } from "../../src/schemas/ajv-schema-adapter.js";
import type { SchemaValidator } from "../../src/schemas/schema-validator.js";
import { ZodSchemaAdapter } from "../../src/schemas/zod-schema-adapter.js";

// --- Shared test data ---

const validFrd = {
	projectName: "Test",
	version: "1.0",
	epics: [
		{
			id: "E1",
			title: "Epic 1",
			description: "Desc",
			userStories: [
				{
					id: "US1",
					title: "Story",
					asA: "user",
					iWant: "feature",
					soThat: "benefit",
					acceptanceCriteria: ["AC1"],
					priority: "must-have",
				},
			],
		},
	],
	businessRules: ["rule"],
	assumptions: ["assume"],
	constraints: ["constraint"],
	outOfScope: ["oos"],
};

const invalidFrd = { projectName: 123, version: null };

// --- ZodSchemaAdapter ---

describe("ZodSchemaAdapter", () => {
	const zodSchema = z.object({
		projectName: z.string(),
		version: z.string(),
		epics: z.array(z.object({ id: z.string() })).min(1),
		businessRules: z.array(z.string()),
		assumptions: z.array(z.string()),
		constraints: z.array(z.string()),
		outOfScope: z.array(z.string()),
	});
	const adapter: SchemaValidator = new ZodSchemaAdapter(zodSchema);

	it("returns success for valid data", () => {
		const result = adapter.validate(validFrd);
		expect(result.success).toBe(true);
		expect(result.errors).toBeUndefined();
	});

	it("returns errors for invalid data", () => {
		const result = adapter.validate(invalidFrd);
		expect(result.success).toBe(false);
		expect(result.errors).toBeDefined();
		expect(result.errors?.length).toBeGreaterThan(0);
	});

	it("does not expose jsonSchema", () => {
		expect(adapter.jsonSchema).toBeUndefined();
	});
});

// --- AjvSchemaAdapter ---

describe("AjvSchemaAdapter", () => {
	const jsonSchema = {
		type: "object",
		required: [
			"projectName",
			"version",
			"epics",
			"businessRules",
			"assumptions",
			"constraints",
			"outOfScope",
		],
		properties: {
			projectName: { type: "string" },
			version: { type: "string" },
			epics: { type: "array", minItems: 1, items: { type: "object" } },
			businessRules: { type: "array", items: { type: "string" } },
			assumptions: { type: "array", items: { type: "string" } },
			constraints: { type: "array", items: { type: "string" } },
			outOfScope: { type: "array", items: { type: "string" } },
		},
	};

	const ajv = new Ajv({ allErrors: true });
	const validateFn = ajv.compile(jsonSchema);
	const adapter: SchemaValidator = new AjvSchemaAdapter(validateFn, jsonSchema);

	it("returns success for valid data", () => {
		const result = adapter.validate(validFrd);
		expect(result.success).toBe(true);
		expect(result.errors).toBeUndefined();
	});

	it("returns errors for invalid data", () => {
		const result = adapter.validate(invalidFrd);
		expect(result.success).toBe(false);
		expect(result.errors).toBeDefined();
		expect(result.errors?.length).toBeGreaterThan(0);
	});

	it("exposes the raw jsonSchema", () => {
		expect(adapter.jsonSchema).toEqual(jsonSchema);
	});

	it("reports missing required fields", () => {
		const result = adapter.validate({ projectName: "X" });
		expect(result.success).toBe(false);
		expect(result.errors?.some((e) => e.includes("version"))).toBe(true);
	});
});
