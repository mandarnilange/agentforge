import { describe, expect, it } from "vitest";
import { NfrSchema } from "../../src/schemas/nfr.schema.js";

const validNfr = {
	performance: {
		responseTime: { p95: "200ms", p99: "500ms" },
		throughput: "1000 requests per second",
		concurrentUsers: 5000,
	},
	security: {
		authentication: "OAuth2 + JWT",
		authorization: "RBAC with fine-grained permissions",
		dataEncryption: "AES-256 at rest, TLS 1.3 in transit",
		additionalRequirements: ["Rate limiting on all API endpoints"],
	},
	scalability: {
		horizontalScaling: true,
		expectedGrowth: "10x over 2 years",
		strategy: "Stateless services behind load balancer",
	},
	availability: {
		uptime: "99.9%",
		rto: "4 hours",
		rpo: "1 hour",
		disasterRecovery: "Multi-region active-passive failover",
	},
	compliance: {
		gdpr: true,
		wcagLevel: "AA",
		additionalStandards: ["SOC 2 Type II"],
	},
	maintainability: {
		codeQuality: "Enforced via ESLint, Prettier, and CI checks",
		testCoverage: "80% minimum",
		documentation: "API docs auto-generated from OpenAPI spec",
	},
};

describe("NfrSchema", () => {
	it("accepts a valid NFR document", () => {
		const result = NfrSchema.safeParse(validNfr);
		expect(result.success).toBe(true);
	});

	it("rejects NFR missing performance section", () => {
		const { performance, ...rest } = validNfr;
		const result = NfrSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects NFR missing security section", () => {
		const { security, ...rest } = validNfr;
		const result = NfrSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects NFR with invalid WCAG level", () => {
		const nfr = {
			...validNfr,
			compliance: {
				...validNfr.compliance,
				wcagLevel: "C",
			},
		};
		const result = NfrSchema.safeParse(nfr);
		expect(result.success).toBe(false);
	});

	it("accepts NFR with optional fields omitted", () => {
		const nfr = {
			performance: {
				responseTime: { p95: "300ms" },
				throughput: "500 rps",
				concurrentUsers: 1000,
			},
			security: {
				authentication: "JWT",
				authorization: "RBAC",
				dataEncryption: "AES-256",
			},
			scalability: {
				horizontalScaling: false,
				expectedGrowth: "2x",
			},
			availability: {
				uptime: "99.5%",
			},
			compliance: {
				gdpr: false,
			},
			maintainability: {
				codeQuality: "Linted",
				testCoverage: "70%",
			},
		};
		const result = NfrSchema.safeParse(nfr);
		expect(result.success).toBe(true);
	});

	it("rejects NFR with non-numeric concurrentUsers", () => {
		const nfr = {
			...validNfr,
			performance: {
				...validNfr.performance,
				concurrentUsers: "lots",
			},
		};
		const result = NfrSchema.safeParse(nfr);
		expect(result.success).toBe(false);
	});
});
