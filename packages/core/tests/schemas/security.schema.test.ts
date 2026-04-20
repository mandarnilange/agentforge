import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

describe("Security schemas", () => {
	describe("threat-model", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("threat-model")).toBeDefined();
		});

		it("validates a valid threat-model artifact", () => {
			const schema = getSchemaForType("threat-model");
			const valid = {
				threats: [
					{
						id: "T-001",
						title: "SQL Injection",
						category: "injection",
						severity: "critical",
						description: "Attacker injects malicious SQL via user input",
						mitigation: "Use parameterized queries",
					},
				],
				dataFlows: [],
				trustBoundaries: [],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing threats array", () => {
			const schema = getSchemaForType("threat-model");
			expect(schema?.safeParse({ dataFlows: [] }).success).toBe(false);
		});
	});

	describe("vulnerability-scan", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("vulnerability-scan")).toBeDefined();
		});

		it("validates a valid vulnerability-scan artifact", () => {
			const schema = getSchemaForType("vulnerability-scan");
			const valid = {
				findings: [
					{
						id: "CVE-2024-001",
						severity: "high",
						title: "Prototype pollution",
						package: "lodash",
						version: "4.17.20",
						fixedIn: "4.17.21",
					},
				],
				totalFindings: 1,
				criticalCount: 0,
				highCount: 1,
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("compliance-evidence", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("compliance-evidence")).toBeDefined();
		});

		it("validates a valid compliance-evidence artifact", () => {
			const schema = getSchemaForType("compliance-evidence");
			const valid = {
				framework: "OWASP Top 10",
				controls: [
					{
						id: "A01",
						title: "Broken Access Control",
						status: "compliant",
						evidence: "RBAC implemented",
					},
				],
				overallStatus: "compliant",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("security-backlog", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("security-backlog")).toBeDefined();
		});

		it("validates a valid security-backlog artifact", () => {
			const schema = getSchemaForType("security-backlog");
			const valid = {
				items: [
					{
						id: "SEC-001",
						title: "Enable HSTS",
						priority: "high",
						effort: "small",
						description: "Add Strict-Transport-Security header",
					},
				],
				totalItems: 1,
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});
});
