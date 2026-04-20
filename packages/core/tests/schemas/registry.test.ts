import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

const ARTIFACT_TYPES = [
	"frd",
	"nfr",
	"tech-stack-recommendation",
	"timeline",
	"effort-estimate",
	"project-proposal",
	"wireframes",
	"design-tokens",
] as const;

describe("Schema Registry", () => {
	it.each(ARTIFACT_TYPES)("returns a schema for artifact type '%s'", (type) => {
		const schema = getSchemaForType(type);
		expect(schema).toBeDefined();
	});

	it("returns undefined for unknown artifact type", () => {
		const schema = getSchemaForType("not-a-real-type");
		expect(schema).toBeUndefined();
	});

	it("returned schemas have a safeParse method", () => {
		for (const type of ARTIFACT_TYPES) {
			const schema = getSchemaForType(type);
			expect(schema).toBeDefined();
			expect(typeof schema?.safeParse).toBe("function");
		}
	});

	it("FRD schema validates correctly through registry", () => {
		const schema = getSchemaForType("frd");
		expect(schema).toBeDefined();
		const invalid = schema?.safeParse({ random: "data" });
		expect(invalid?.success).toBe(false);
	});
});
