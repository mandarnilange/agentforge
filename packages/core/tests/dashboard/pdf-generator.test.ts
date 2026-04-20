import { describe, expect, it } from "vitest";
import { generateArtifactPdf } from "../../src/dashboard/pdf-generator.js";

describe("PDF generator", () => {
	it("generates a valid PDF buffer from a simple artifact", async () => {
		const data = {
			projectName: "Test Project",
			version: "1.0.0",
			epics: [
				{
					id: "E1",
					title: "Auth Module",
					description: "User authentication",
				},
			],
		};
		const buffer = await generateArtifactPdf(data, "frd.json");
		expect(buffer).toBeInstanceOf(Buffer);
		expect(buffer.length).toBeGreaterThan(0);
		// PDF magic bytes: %PDF
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("handles nested objects and arrays", async () => {
		const data = {
			threats: [
				{
					id: "T1",
					title: "SQL Injection",
					severity: "critical",
					mitigation: "Use parameterized queries",
				},
			],
		};
		const buffer = await generateArtifactPdf(data, "threat-model.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("handles empty data", async () => {
		const buffer = await generateArtifactPdf({}, "empty.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("handles string content (non-JSON artifact)", async () => {
		const buffer = await generateArtifactPdf(
			"CREATE TABLE users (id UUID PRIMARY KEY);",
			"schema-ddl.sql",
		);
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders string arrays as bullet lists", async () => {
		const data = {
			tags: ["rest", "backend", "openapi"],
		};
		const buffer = await generateArtifactPdf(data, "tags.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders empty arrays as 'None'", async () => {
		const data = {
			risks: [],
		};
		const buffer = await generateArtifactPdf(data, "empty-array.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders mixed arrays (non-string, non-object) as stringified bullets", async () => {
		const data = {
			values: [1, 2, true, null],
		};
		const buffer = await generateArtifactPdf(data, "mixed.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders nested objects (depth > 0)", async () => {
		const data = {
			config: {
				database: {
					host: "localhost",
					port: 5432,
				},
			},
		};
		const buffer = await generateArtifactPdf(data, "nested.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders primitives as the top-level artifact", async () => {
		const buffer = await generateArtifactPdf(42, "number.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders null as the top-level artifact", async () => {
		const buffer = await generateArtifactPdf(null, "null.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});

	it("renders objects with severity badges", async () => {
		const data = {
			findings: [
				{ id: "F1", title: "Auth bug", severity: "high" },
				{ id: "F2", title: "SQL injection", severity: "critical" },
				{ id: "F3", title: "Typo", severity: "low" },
			],
		};
		const buffer = await generateArtifactPdf(data, "findings.json");
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
	});
});
