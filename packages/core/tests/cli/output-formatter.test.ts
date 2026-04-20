import { describe, expect, it } from "vitest";
import { formatOutput } from "../../src/cli/output-formatter.js";

describe("OutputFormatter (P15.5-T11)", () => {
	const data = [
		{ name: "developer", phase: 4, executor: "pi-coding-agent", version: 2 },
		{ name: "analyst", phase: 1, executor: "pi-ai", version: 1 },
	];

	const columns = [
		{ key: "name", header: "NAME" },
		{ key: "phase", header: "PHASE" },
		{ key: "executor", header: "EXECUTOR" },
		{ key: "version", header: "VERSION" },
	];

	it("formats as table (default)", () => {
		const output = formatOutput(data, columns, "table");
		expect(output).toContain("NAME");
		expect(output).toContain("developer");
		expect(output).toContain("analyst");
	});

	it("formats as JSON", () => {
		const output = formatOutput(data, columns, "json");
		const parsed = JSON.parse(output);
		expect(parsed).toHaveLength(2);
		expect(parsed[0].name).toBe("developer");
	});

	it("formats as YAML", () => {
		const output = formatOutput(data, columns, "yaml");
		expect(output).toContain("name: developer");
		expect(output).toContain("name: analyst");
	});

	it("formats as wide (includes all fields)", () => {
		const wideData = [
			{
				name: "developer",
				phase: 4,
				executor: "pi-coding-agent",
				version: 2,
				createdAt: "2026-04-08",
			},
		];
		const wideCols = [...columns, { key: "createdAt", header: "CREATED" }];
		const output = formatOutput(wideData, wideCols, "wide");
		expect(output).toContain("CREATED");
		expect(output).toContain("2026-04-08");
	});

	it("handles empty data", () => {
		const output = formatOutput([], columns, "table");
		expect(output).toContain("No resources found");
	});

	it("formats single object (for describe)", () => {
		const output = formatOutput(data[0], columns, "json");
		const parsed = JSON.parse(output);
		expect(parsed.name).toBe("developer");
	});
});
