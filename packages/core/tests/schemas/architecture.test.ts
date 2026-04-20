import { describe, expect, it } from "vitest";
import { AdrSchema } from "../../src/schemas/adr.schema.js";
import { ArchOptionsSchema } from "../../src/schemas/arch-options.schema.js";
import { ArchitectureSchema } from "../../src/schemas/architecture.schema.js";
import { DeploymentTopologySchema } from "../../src/schemas/deployment-topology.schema.js";
import { getSchemaForType } from "../../src/schemas/index.js";
import { SecurityDesignSchema } from "../../src/schemas/security-design.schema.js";

// --- Architecture Schema ---

const validArchitecture = {
	pattern: "microservices",
	components: [
		{
			id: "COMP-001",
			name: "API Gateway",
			type: "gateway",
			responsibility:
				"Route external requests, rate limiting, auth verification",
			technology: "Kong",
			interfaces: [
				{
					name: "REST API",
					protocol: "HTTPS",
					port: 443,
				},
			],
		},
		{
			id: "COMP-002",
			name: "User Service",
			type: "service",
			responsibility: "User management, authentication, authorization",
			technology: "Node.js / NestJS",
		},
	],
	communication: [
		{
			from: "COMP-001",
			to: "COMP-002",
			protocol: "HTTP/REST",
			pattern: "synchronous",
		},
	],
	dataFlow: [
		{
			source: "API Gateway",
			destination: "User Service",
			data: "Auth requests",
		},
	],
};

describe("ArchitectureSchema", () => {
	it("accepts a valid architecture artifact", () => {
		const result = ArchitectureSchema.safeParse(validArchitecture);
		expect(result.success).toBe(true);
	});

	it("accepts architecture with optional fields omitted", () => {
		const minimal = {
			pattern: "monolith",
			components: [
				{
					id: "COMP-001",
					name: "App Server",
					type: "service",
					responsibility: "Handles all business logic",
					technology: "Node.js",
				},
			],
		};
		const result = ArchitectureSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects architecture missing required pattern", () => {
		const { pattern, ...rest } = validArchitecture;
		const result = ArchitectureSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects architecture missing required components", () => {
		const { components, ...rest } = validArchitecture;
		const result = ArchitectureSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects architecture with empty components array", () => {
		const result = ArchitectureSchema.safeParse({
			...validArchitecture,
			components: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects component missing id", () => {
		const result = ArchitectureSchema.safeParse({
			...validArchitecture,
			components: [
				{
					name: "No ID",
					type: "service",
					responsibility: "Something",
					technology: "Node.js",
				},
			],
		});
		expect(result.success).toBe(false);
	});
});

// --- ADR Schema ---

const validAdr = {
	id: "ADR-001",
	title: "Use microservices architecture",
	status: "accepted",
	context: "The system needs to scale independently per domain",
	decision: "Adopt microservices with event-driven communication",
	consequences: [
		"Increased operational complexity",
		"Independent deployability per service",
	],
};

describe("AdrSchema", () => {
	it("accepts a valid ADR", () => {
		const result = AdrSchema.safeParse(validAdr);
		expect(result.success).toBe(true);
	});

	it("accepts ADR with optional fields", () => {
		const full = {
			...validAdr,
			date: "2026-04-03",
			alternatives: ["Monolith", "Modular monolith"],
			relatedAdrs: ["ADR-002"],
		};
		const result = AdrSchema.safeParse(full);
		expect(result.success).toBe(true);
	});

	it("rejects ADR missing title", () => {
		const { title, ...rest } = validAdr;
		const result = AdrSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects ADR missing decision", () => {
		const { decision, ...rest } = validAdr;
		const result = AdrSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects ADR with invalid status", () => {
		const result = AdrSchema.safeParse({
			...validAdr,
			status: "maybe",
		});
		expect(result.success).toBe(false);
	});
});

// --- Deployment Topology Schema ---

const validTopology = {
	environment: "production",
	services: [
		{
			name: "api-gateway",
			componentId: "COMP-001",
			replicas: 3,
			resources: { cpu: "500m", memory: "512Mi" },
		},
	],
};

describe("DeploymentTopologySchema", () => {
	it("accepts a valid deployment topology", () => {
		const result = DeploymentTopologySchema.safeParse(validTopology);
		expect(result.success).toBe(true);
	});

	it("accepts topology with optional regions and networking", () => {
		const full = {
			...validTopology,
			regions: ["us-east-1", "eu-west-1"],
			networking: {
				vpc: "10.0.0.0/16",
				subnets: ["public", "private"],
			},
		};
		const result = DeploymentTopologySchema.safeParse(full);
		expect(result.success).toBe(true);
	});

	it("rejects topology missing environment", () => {
		const { environment, ...rest } = validTopology;
		const result = DeploymentTopologySchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects topology missing services", () => {
		const { services, ...rest } = validTopology;
		const result = DeploymentTopologySchema.safeParse(rest);
		expect(result.success).toBe(false);
	});
});

// --- Arch Options Schema ---

const validArchOptions = {
	options: [
		{
			id: "OPT-001",
			name: "Microservices on K8s",
			description: "Fully containerized microservices on Kubernetes",
			pros: ["Independent scaling", "Polyglot"],
			cons: ["Operational complexity", "Network latency"],
			tradeoffs: "Higher ops cost for better scalability",
			estimatedCost: "High",
			recommended: true,
		},
		{
			id: "OPT-002",
			name: "Modular Monolith",
			description: "Single deployable with internal module boundaries",
			pros: ["Simpler operations", "Lower latency"],
			cons: ["Coupled deployments"],
			tradeoffs: "Simpler ops but harder to scale independently",
			estimatedCost: "Low",
		},
	],
};

describe("ArchOptionsSchema", () => {
	it("accepts valid architecture options", () => {
		const result = ArchOptionsSchema.safeParse(validArchOptions);
		expect(result.success).toBe(true);
	});

	it("rejects options missing required fields", () => {
		const result = ArchOptionsSchema.safeParse({
			options: [{ id: "OPT-001" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects empty options array", () => {
		const result = ArchOptionsSchema.safeParse({ options: [] });
		expect(result.success).toBe(false);
	});

	it("accepts options with comparison matrix", () => {
		const withMatrix = {
			...validArchOptions,
			comparisonMatrix: {
				criteria: ["scalability", "cost", "complexity"],
				scores: {
					"OPT-001": { scalability: "high", cost: "high", complexity: "high" },
					"OPT-002": { scalability: "medium", cost: "low", complexity: "low" },
				},
			},
		};
		const result = ArchOptionsSchema.safeParse(withMatrix);
		expect(result.success).toBe(true);
	});
});

// --- Security Design Schema ---

const validSecurityDesign = {
	authPattern: {
		type: "OAuth2 + JWT",
		description: "OAuth2 authorization code flow with JWT access tokens",
	},
	encryption: {
		atRest: "AES-256",
		inTransit: "TLS 1.3",
	},
	dataProtection: [
		{
			category: "PII",
			measures: ["Field-level encryption", "Anonymization for analytics"],
		},
	],
};

describe("SecurityDesignSchema", () => {
	it("accepts a valid security design", () => {
		const result = SecurityDesignSchema.safeParse(validSecurityDesign);
		expect(result.success).toBe(true);
	});

	it("accepts security design with optional threat model", () => {
		const full = {
			...validSecurityDesign,
			threats: [
				{
					id: "THREAT-001",
					name: "SQL Injection",
					severity: "high",
					mitigation: "Parameterized queries, ORM usage",
				},
			],
			complianceRequirements: ["GDPR", "SOC 2"],
		};
		const result = SecurityDesignSchema.safeParse(full);
		expect(result.success).toBe(true);
	});

	it("rejects security design missing authPattern", () => {
		const { authPattern, ...rest } = validSecurityDesign;
		const result = SecurityDesignSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects security design missing encryption", () => {
		const { encryption, ...rest } = validSecurityDesign;
		const result = SecurityDesignSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});
});

// --- Schema Registry ---

const STRATIX_ARTIFACT_TYPES = [
	"architecture",
	"adr",
	"deployment-topology",
	"arch-options",
	"security-design",
	"component-diagram",
	"adrs",
	"tech-stack-confirmed",
] as const;

describe("Schema Registry — Architect types", () => {
	it.each(
		STRATIX_ARTIFACT_TYPES,
	)("returns a schema for artifact type '%s'", (type) => {
		const schema = getSchemaForType(type);
		expect(schema).toBeDefined();
		expect(typeof schema?.safeParse).toBe("function");
	});
});
