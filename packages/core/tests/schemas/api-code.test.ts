import { describe, expect, it } from "vitest";
import { ApiCodeSchema } from "../../src/schemas/api-code.schema.js";
import { ApiDocsSchema } from "../../src/schemas/api-docs.schema.js";
import { ApiTestsSchema } from "../../src/schemas/api-tests.schema.js";
import { getSchemaForType } from "../../src/schemas/index.js";
import { OpenApiSpecSchema } from "../../src/schemas/openapi-spec.schema.js";

// --- ApiCode Schema ---

const validApiCode = {
	files: [
		{
			path: "src/controllers/user.controller.ts",
			language: "typescript",
			description: "User CRUD controller with input validation",
		},
		{
			path: "src/services/user.service.ts",
			language: "typescript",
			description: "User business logic service",
		},
	],
	commitSha: "abc123def456",
	framework: "express",
	entrypoint: "src/index.ts",
};

describe("ApiCodeSchema", () => {
	it("accepts a valid api-code manifest", () => {
		const result = ApiCodeSchema.safeParse(validApiCode);
		expect(result.success).toBe(true);
	});

	it("accepts api-code with optional fields omitted", () => {
		const minimal = {
			files: [
				{
					path: "src/index.ts",
					language: "typescript",
					description: "Main entry point",
				},
			],
			framework: "fastify",
			entrypoint: "src/index.ts",
		};
		const result = ApiCodeSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects api-code with empty files array", () => {
		const result = ApiCodeSchema.safeParse({
			...validApiCode,
			files: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects api-code missing framework", () => {
		const { framework, ...rest } = validApiCode;
		const result = ApiCodeSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects api-code missing entrypoint", () => {
		const { entrypoint, ...rest } = validApiCode;
		const result = ApiCodeSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("accepts api-code with null commitSha", () => {
		const result = ApiCodeSchema.safeParse({
			...validApiCode,
			commitSha: null,
		});
		expect(result.success).toBe(true);
	});

	it("rejects file entry missing path", () => {
		const result = ApiCodeSchema.safeParse({
			...validApiCode,
			files: [{ language: "typescript", description: "No path" }],
		});
		expect(result.success).toBe(false);
	});

	it("accepts api-code with extra metadata on files", () => {
		const withMeta = {
			...validApiCode,
			files: [
				{
					path: "src/index.ts",
					language: "typescript",
					description: "Entry",
					linesOfCode: 42,
				},
			],
		};
		const result = ApiCodeSchema.safeParse(withMeta);
		expect(result.success).toBe(true);
	});
});

// --- OpenAPI Spec Schema ---

const validOpenApiSpec = {
	openapi: "3.0.3",
	info: {
		title: "User API",
		version: "1.0.0",
	},
	paths: {
		"/users": {
			get: {
				summary: "List users",
				responses: {
					"200": { description: "Success" },
				},
			},
		},
	},
};

describe("OpenApiSpecSchema", () => {
	it("accepts a valid openapi-spec", () => {
		const result = OpenApiSpecSchema.safeParse(validOpenApiSpec);
		expect(result.success).toBe(true);
	});

	it("accepts openapi-spec with components", () => {
		const withComponents = {
			...validOpenApiSpec,
			components: {
				schemas: {
					User: {
						type: "object",
						properties: { id: { type: "string" } },
					},
				},
			},
		};
		const result = OpenApiSpecSchema.safeParse(withComponents);
		expect(result.success).toBe(true);
	});

	it("rejects openapi-spec missing openapi version", () => {
		const { openapi, ...rest } = validOpenApiSpec;
		const result = OpenApiSpecSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects openapi-spec missing info", () => {
		const { info, ...rest } = validOpenApiSpec;
		const result = OpenApiSpecSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects openapi-spec missing paths", () => {
		const { paths, ...rest } = validOpenApiSpec;
		const result = OpenApiSpecSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("accepts openapi-spec with servers and security", () => {
		const full = {
			...validOpenApiSpec,
			servers: [{ url: "https://api.example.com" }],
			security: [{ bearerAuth: [] }],
		};
		const result = OpenApiSpecSchema.safeParse(full);
		expect(result.success).toBe(true);
	});
});

// --- API Tests Schema ---

const validApiTests = {
	testFiles: [
		{
			path: "tests/user.test.ts",
			description: "User endpoint integration tests",
			testCount: 12,
		},
	],
	framework: "vitest",
	coverageTargets: {
		statements: 80,
		branches: 75,
		functions: 80,
		lines: 80,
	},
};

describe("ApiTestsSchema", () => {
	it("accepts a valid api-tests manifest", () => {
		const result = ApiTestsSchema.safeParse(validApiTests);
		expect(result.success).toBe(true);
	});

	it("accepts api-tests with jest framework", () => {
		const result = ApiTestsSchema.safeParse({
			...validApiTests,
			framework: "jest",
		});
		expect(result.success).toBe(true);
	});

	it("rejects api-tests with empty testFiles", () => {
		const result = ApiTestsSchema.safeParse({
			...validApiTests,
			testFiles: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects api-tests missing framework", () => {
		const { framework, ...rest } = validApiTests;
		const result = ApiTestsSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("accepts api-tests without coverageTargets", () => {
		const { coverageTargets, ...rest } = validApiTests;
		const result = ApiTestsSchema.safeParse(rest);
		expect(result.success).toBe(true);
	});
});

// --- API Docs Schema ---

const validApiDocs = {
	endpoints: [
		{
			method: "GET",
			path: "/users",
			description: "List all users with pagination",
			requestExample: { query: { page: 1, limit: 20 } },
			responseExample: {
				status: 200,
				body: { data: [], total: 0 },
			},
		},
		{
			method: "POST",
			path: "/users",
			description: "Create a new user",
			requestExample: { body: { name: "Alice", email: "alice@example.com" } },
			responseExample: {
				status: 201,
				body: { id: "usr-001", name: "Alice" },
			},
		},
	],
};

describe("ApiDocsSchema", () => {
	it("accepts a valid api-docs artifact", () => {
		const result = ApiDocsSchema.safeParse(validApiDocs);
		expect(result.success).toBe(true);
	});

	it("rejects api-docs with empty endpoints", () => {
		const result = ApiDocsSchema.safeParse({ endpoints: [] });
		expect(result.success).toBe(false);
	});

	it("rejects endpoint missing method", () => {
		const result = ApiDocsSchema.safeParse({
			endpoints: [{ path: "/users", description: "List users" }],
		});
		expect(result.success).toBe(false);
	});

	it("rejects endpoint missing path", () => {
		const result = ApiDocsSchema.safeParse({
			endpoints: [{ method: "GET", description: "List users" }],
		});
		expect(result.success).toBe(false);
	});

	it("accepts endpoint without examples", () => {
		const result = ApiDocsSchema.safeParse({
			endpoints: [
				{
					method: "DELETE",
					path: "/users/:id",
					description: "Delete a user",
				},
			],
		});
		expect(result.success).toBe(true);
	});

	it("accepts api-docs with extra metadata", () => {
		const result = ApiDocsSchema.safeParse({
			...validApiDocs,
			title: "User API Documentation",
			version: "1.0.0",
		});
		expect(result.success).toBe(true);
	});
});

// --- Schema Registry — Developer types ---

const FORGEX_ARTIFACT_TYPES = [
	"api-code",
	"openapi-spec",
	"api-tests",
	"api-docs",
] as const;

describe("Schema Registry — Developer types", () => {
	it.each(
		FORGEX_ARTIFACT_TYPES,
	)("returns a schema for artifact type '%s'", (type) => {
		const schema = getSchemaForType(type);
		expect(schema).toBeDefined();
		expect(typeof schema?.safeParse).toBe("function");
	});
});
