import { describe, expect, it } from "vitest";
import {
	buildOutputEnvelope,
	injectOutputSchemas,
} from "../../src/agents/prompt-schema-injector.js";
import type { SchemaValidator } from "../../src/schemas/schema-validator.js";

const makeValidator = (schema: Record<string, unknown>): SchemaValidator => ({
	validate: () => ({ success: true }),
	jsonSchema: schema,
});

const frdSchema = {
	type: "object",
	description: "Functional requirements document",
	properties: {
		projectName: { type: "string", description: "Name of the project" },
		version: { type: "string", description: "Schema version" },
	},
	required: ["projectName", "version"],
};

const nfrSchema = {
	type: "object",
	properties: {
		performance: { type: "array", items: { type: "object" } },
	},
};

describe("buildOutputEnvelope", () => {
	it("returns a JSON envelope string listing all output types", () => {
		const envelope = buildOutputEnvelope(["frd", "nfr", "timeline"]);
		const parsed = JSON.parse(envelope);
		expect(parsed.artifacts).toBeDefined();
		expect(Object.keys(parsed.artifacts)).toEqual(["frd", "nfr", "timeline"]);
	});

	it("uses { ... } as placeholder value for each artifact", () => {
		const envelope = buildOutputEnvelope(["frd"]);
		expect(envelope).toContain('"frd"');
	});

	it("returns empty artifacts for no outputs", () => {
		const envelope = buildOutputEnvelope([]);
		const parsed = JSON.parse(envelope);
		expect(Object.keys(parsed.artifacts)).toHaveLength(0);
	});
});

describe("injectOutputSchemas", () => {
	const outputs = [
		{ type: "frd", schema: "schemas/frd.schema.yaml" },
		{ type: "nfr", schema: "schemas/nfr.schema.yaml" },
	];

	const getValidator = (type: string): SchemaValidator | undefined => {
		if (type === "frd") return makeValidator(frdSchema);
		if (type === "nfr") return makeValidator(nfrSchema);
		return undefined;
	};

	it("replaces {{output_schemas}} with a schemas section", () => {
		const prompt = "You are an agent.\n\n{{output_schemas}}\n\nBe helpful.";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		expect(result).not.toContain("{{output_schemas}}");
		expect(result).toContain("frd");
		expect(result).toContain("nfr");
	});

	it("includes output format envelope in the injected section", () => {
		const prompt = "{{output_schemas}}";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		expect(result).toContain('"artifacts"');
	});

	it("includes JSON schema for each output type", () => {
		const prompt = "{{output_schemas}}";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		expect(result).toContain("projectName");
		expect(result).toContain("performance");
	});

	it("includes schema descriptions in the injected section", () => {
		const prompt = "{{output_schemas}}";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		expect(result).toContain("Name of the project");
	});

	it("skips outputs with no validator", () => {
		const prompt = "{{output_schemas}}";
		const outputsWithUnknown = [
			...outputs,
			{ type: "unknown-type", schema: "schemas/unknown.schema.yaml" },
		];
		// Should not throw
		const result = injectOutputSchemas(
			prompt,
			outputsWithUnknown,
			getValidator,
		);
		expect(result).not.toContain("{{output_schemas}}");
		expect(result).not.toContain("unknown-type");
	});

	it("skips outputs with no jsonSchema (Zod-only validators)", () => {
		const zodOnlyValidator: SchemaValidator = {
			validate: () => ({ success: true }),
			jsonSchema: undefined,
		};
		const getZodValidator = (_type: string) => zodOnlyValidator;
		const prompt = "{{output_schemas}}";
		const result = injectOutputSchemas(
			prompt,
			[{ type: "frd", schema: "" }],
			getZodValidator,
		);
		expect(result).not.toContain("{{output_schemas}}");
	});

	it("returns prompt unchanged if no placeholder present", () => {
		const prompt = "No placeholder here.";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		expect(result).toBe(prompt);
	});

	it("injects output format envelope listing artifact keys", () => {
		const prompt = "{{output_schemas}}";
		const result = injectOutputSchemas(prompt, outputs, getValidator);
		// The envelope shows which artifact keys to produce
		expect(result).toMatch(/"frd"\s*:/);
		expect(result).toMatch(/"nfr"\s*:/);
	});
});
