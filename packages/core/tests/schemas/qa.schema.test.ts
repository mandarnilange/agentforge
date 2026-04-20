import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

describe("QA schemas", () => {
	describe("test-suite", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("test-suite")).toBeDefined();
		});

		it("validates a valid test-suite artifact", () => {
			const schema = getSchemaForType("test-suite");
			const valid = {
				files: [
					{
						path: "tests/user.test.ts",
						language: "typescript",
						description: "User endpoint tests",
						type: "integration",
					},
				],
				framework: "vitest",
				totalTests: 42,
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing files array", () => {
			const schema = getSchemaForType("test-suite");
			expect(
				schema?.safeParse({ framework: "jest", totalTests: 0 }).success,
			).toBe(false);
		});
	});

	describe("coverage-report", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("coverage-report")).toBeDefined();
		});

		it("validates a valid coverage-report artifact", () => {
			const schema = getSchemaForType("coverage-report");
			const valid = {
				lineCoverage: 87.5,
				branchCoverage: 80.0,
				functionCoverage: 92.0,
				statementCoverage: 88.0,
				summary: "Coverage meets threshold",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects coverage report with missing lineCoverage", () => {
			const schema = getSchemaForType("coverage-report");
			expect(schema?.safeParse({ branchCoverage: 80 }).success).toBe(false);
		});
	});

	describe("defect-log", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("defect-log")).toBeDefined();
		});

		it("validates a valid defect-log artifact", () => {
			const schema = getSchemaForType("defect-log");
			const valid = {
				defects: [
					{
						id: "DEF-001",
						severity: "high",
						title: "SQL injection vulnerability",
						description: "Unparameterized query in user search",
						location: "src/users/search.ts:42",
					},
				],
				totalDefects: 1,
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("release-readiness", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("release-readiness")).toBeDefined();
		});

		it("validates a valid release-readiness artifact", () => {
			const schema = getSchemaForType("release-readiness");
			const valid = {
				ready: true,
				score: 95,
				criteria: [
					{ name: "All tests pass", met: true },
					{ name: "Coverage above threshold", met: true },
				],
				blockers: [],
				recommendation: "Approved for release",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing ready field", () => {
			const schema = getSchemaForType("release-readiness");
			expect(
				schema?.safeParse({ score: 90, criteria: [], blockers: [] }).success,
			).toBe(false);
		});
	});
});
