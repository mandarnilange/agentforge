import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

describe("DevOps schemas", () => {
	describe("cicd-config", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("cicd-config")).toBeDefined();
		});

		it("validates a valid cicd-config artifact", () => {
			const schema = getSchemaForType("cicd-config");
			const valid = {
				platform: "github-actions",
				files: [
					{
						path: ".github/workflows/ci.yml",
						description: "CI pipeline — test, lint, build",
						content: "name: CI\non: [push]",
					},
				],
				stages: ["test", "build", "deploy"],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing platform", () => {
			const schema = getSchemaForType("cicd-config");
			expect(schema?.safeParse({ files: [], stages: [] }).success).toBe(false);
		});
	});

	describe("deployment-runbook", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("deployment-runbook")).toBeDefined();
		});

		it("validates a valid deployment-runbook artifact", () => {
			const schema = getSchemaForType("deployment-runbook");
			const valid = {
				title: "Production Deployment Runbook",
				steps: [
					{
						order: 1,
						title: "Run smoke tests",
						command: "npm run test:smoke",
						rollbackOnFailure: true,
					},
				],
				rollbackProcedure: "kubectl rollout undo deployment/app",
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("iac-templates", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("iac-templates")).toBeDefined();
		});

		it("validates a valid iac-templates artifact", () => {
			const schema = getSchemaForType("iac-templates");
			const valid = {
				tool: "terraform",
				files: [
					{
						path: "infra/main.tf",
						description: "Main Terraform configuration",
						content: 'provider "aws" {}',
					},
				],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("monitoring-config", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("monitoring-config")).toBeDefined();
		});

		it("validates a valid monitoring-config artifact", () => {
			const schema = getSchemaForType("monitoring-config");
			const valid = {
				platform: "prometheus",
				alerts: [
					{
						name: "HighErrorRate",
						condition: "error_rate > 0.05",
						severity: "critical",
						channel: "pagerduty",
					},
				],
				dashboards: [],
				slos: [],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("deployment-risk", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("deployment-risk")).toBeDefined();
		});

		it("validates a valid deployment-risk artifact", () => {
			const schema = getSchemaForType("deployment-risk");
			const valid = {
				riskScore: 35,
				level: "medium",
				factors: [
					{ factor: "Database migration", impact: "high", probability: "low" },
				],
				recommendation: "Deploy during low-traffic window",
				approvalRequired: true,
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing riskScore", () => {
			const schema = getSchemaForType("deployment-risk");
			expect(schema?.safeParse({ level: "low", factors: [] }).success).toBe(
				false,
			);
		});
	});
});
