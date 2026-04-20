import { afterEach, describe, expect, it } from "vitest";
import {
	getSchemaForType,
	getValidatorForType,
	resetDiscoveredSchemas,
	setDiscoveredSchemas,
} from "../../src/schemas/index.js";
import type { SchemaValidator } from "../../src/schemas/schema-validator.js";
import { ZodSchemaAdapter } from "../../src/schemas/zod-schema-adapter.js";

describe("getValidatorForType", () => {
	afterEach(() => {
		resetDiscoveredSchemas();
	});

	it("returns a ZodSchemaAdapter for built-in types when no override exists", () => {
		const validator = getValidatorForType("frd");
		expect(validator).toBeDefined();
		expect(validator).toBeInstanceOf(ZodSchemaAdapter);
	});

	it("returns undefined for unknown types", () => {
		const validator = getValidatorForType("nonexistent-type");
		expect(validator).toBeUndefined();
	});

	it("returns discovered schema when override is set", () => {
		const mockValidator: SchemaValidator = {
			validate: () => ({ success: true }),
			jsonSchema: { type: "object" },
		};
		setDiscoveredSchemas(new Map([["frd", mockValidator]]));

		const validator = getValidatorForType("frd");
		expect(validator).toBe(mockValidator);
		expect(validator).not.toBeInstanceOf(ZodSchemaAdapter);
	});

	it("falls back to Zod when discovered map has no match", () => {
		setDiscoveredSchemas(
			new Map([["other-type", { validate: () => ({ success: true }) }]]),
		);

		const validator = getValidatorForType("frd");
		expect(validator).toBeDefined();
		expect(validator).toBeInstanceOf(ZodSchemaAdapter);
	});

	it("validates data correctly through ZodSchemaAdapter fallback", () => {
		const validator = getValidatorForType("frd");
		expect(validator).toBeDefined();

		const result = validator?.validate({
			projectName: "Test",
			version: "1.0",
			epics: [
				{
					id: "E1",
					title: "Epic",
					description: "D",
					userStories: [
						{
							id: "US1",
							title: "S",
							asA: "user",
							iWant: "thing",
							soThat: "reason",
							acceptanceCriteria: ["AC1"],
							priority: "must-have",
						},
					],
				},
			],
			businessRules: ["r"],
			assumptions: ["a"],
			constraints: ["c"],
			outOfScope: ["o"],
		});
		expect(result.success).toBe(true);
	});

	it("getSchemaForType still works (backward compat)", () => {
		const zodSchema = getSchemaForType("frd");
		expect(zodSchema).toBeDefined();
	});
});
