import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

describe("Frontend schemas", () => {
	describe("ui-components", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("ui-components")).toBeDefined();
		});

		it("validates a valid ui-components artifact", () => {
			const schema = getSchemaForType("ui-components");
			const valid = {
				components: [
					{
						name: "Button",
						framework: "react",
						files: [
							{
								path: "src/Button.tsx",
								language: "typescript",
								description: "Button component",
							},
						],
					},
				],
				framework: "react",
				designSystemVersion: "1.0.0",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing components array", () => {
			const schema = getSchemaForType("ui-components");
			expect(schema?.safeParse({ framework: "react" }).success).toBe(false);
		});
	});

	describe("accessibility-audit", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("accessibility-audit")).toBeDefined();
		});

		it("validates a valid accessibility-audit artifact", () => {
			const schema = getSchemaForType("accessibility-audit");
			const valid = {
				wcagLevel: "AA",
				violations: [],
				passes: 10,
				summary: "All components meet WCAG 2.1 AA",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing wcagLevel", () => {
			const schema = getSchemaForType("accessibility-audit");
			expect(
				schema?.safeParse({ violations: [], passes: 0, summary: "x" }).success,
			).toBe(false);
		});
	});

	describe("component-docs", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("component-docs")).toBeDefined();
		});

		it("validates a valid component-docs artifact", () => {
			const schema = getSchemaForType("component-docs");
			const valid = {
				components: [
					{
						name: "Button",
						description: "Primary action button",
						props: [],
						examples: [],
					},
				],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});
});
