import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverSchemas } from "../../src/schemas/schema-discovery.js";

const tmpDir = join(process.cwd(), "tmp-schema-discovery-test");
const schemasDir = join(tmpDir, "schemas");

beforeEach(() => {
	mkdirSync(schemasDir, { recursive: true });
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("discoverSchemas", () => {
	it("discovers .schema.yaml files and returns validators keyed by artifact type", () => {
		writeFileSync(
			join(schemasDir, "frd.schema.yaml"),
			`
type: object
required: [projectName, version]
properties:
  projectName:
    type: string
  version:
    type: string
`,
		);

		const validators = discoverSchemas(schemasDir);
		expect(validators.has("frd")).toBe(true);

		const frd = validators.get("frd");
		if (!frd) {
			throw new Error("Expected 'frd' validator to be defined");
		}
		expect(frd.validate({ projectName: "X", version: "1" }).success).toBe(true);
		expect(frd.validate({ projectName: 123 }).success).toBe(false);
	});

	it("discovers .schema.json files", () => {
		writeFileSync(
			join(schemasDir, "nfr.schema.json"),
			JSON.stringify({
				type: "object",
				required: ["requirements"],
				properties: {
					requirements: { type: "array", items: { type: "string" } },
				},
			}),
		);

		const validators = discoverSchemas(schemasDir);
		expect(validators.has("nfr")).toBe(true);
		expect(
			validators.get("nfr")?.validate({ requirements: ["perf"] }).success,
		).toBe(true);
	});

	it("returns empty map for empty directory", () => {
		const validators = discoverSchemas(schemasDir);
		expect(validators.size).toBe(0);
	});

	it("returns empty map for non-existent directory", () => {
		const validators = discoverSchemas(join(tmpDir, "nope"));
		expect(validators.size).toBe(0);
	});

	it("throws on invalid YAML schema", () => {
		writeFileSync(
			join(schemasDir, "bad.schema.yaml"),
			"type: not-a-real-type\nproperties: 123",
		);

		expect(() => discoverSchemas(schemasDir)).toThrow();
	});

	it("exposes jsonSchema on discovered validators", () => {
		writeFileSync(
			join(schemasDir, "simple.schema.yaml"),
			`
type: object
properties:
  name:
    type: string
`,
		);

		const validators = discoverSchemas(schemasDir);
		const schema = validators.get("simple");
		if (!schema) {
			throw new Error("Expected 'simple' validator to be defined");
		}
		expect(schema.jsonSchema).toBeDefined();
		expect(schema.jsonSchema?.type).toBe("object");
	});

	it("discovers multiple schemas from the same directory", () => {
		writeFileSync(
			join(schemasDir, "a.schema.yaml"),
			"type: object\nproperties:\n  x:\n    type: string",
		);
		writeFileSync(
			join(schemasDir, "b.schema.yaml"),
			"type: object\nproperties:\n  y:\n    type: number",
		);
		writeFileSync(
			join(schemasDir, "c.schema.json"),
			JSON.stringify({ type: "object" }),
		);

		const validators = discoverSchemas(schemasDir);
		expect(validators.size).toBe(3);
		expect(validators.has("a")).toBe(true);
		expect(validators.has("b")).toBe(true);
		expect(validators.has("c")).toBe(true);
	});

	it("ignores non-schema files", () => {
		writeFileSync(join(schemasDir, "readme.md"), "# Schemas");
		writeFileSync(join(schemasDir, "config.yaml"), "key: value");
		writeFileSync(
			join(schemasDir, "valid.schema.yaml"),
			"type: object\nproperties:\n  x:\n    type: string",
		);

		const validators = discoverSchemas(schemasDir);
		expect(validators.size).toBe(1);
		expect(validators.has("valid")).toBe(true);
	});
});
