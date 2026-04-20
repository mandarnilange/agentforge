import { describe, expect, it } from "vitest";
import { getSchemaForType } from "../../src/schemas/index.js";

describe("DataEngineer schemas", () => {
	describe("erd", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("erd")).toBeDefined();
		});

		it("validates a valid erd artifact", () => {
			const schema = getSchemaForType("erd");
			const valid = {
				entities: [
					{
						name: "User",
						attributes: [
							{ name: "id", type: "uuid", primaryKey: true },
							{ name: "email", type: "varchar(255)", nullable: false },
						],
					},
				],
				relationships: [],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing entities array", () => {
			const schema = getSchemaForType("erd");
			expect(schema?.safeParse({ relationships: [] }).success).toBe(false);
		});
	});

	describe("schema-ddl", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("schema-ddl")).toBeDefined();
		});

		it("validates a valid schema-ddl artifact", () => {
			const schema = getSchemaForType("schema-ddl");
			const valid = {
				dialect: "postgresql",
				statements: ["CREATE TABLE users (id UUID PRIMARY KEY);"],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});

		it("rejects artifact missing dialect", () => {
			const schema = getSchemaForType("schema-ddl");
			expect(schema?.safeParse({ statements: ["SELECT 1"] }).success).toBe(
				false,
			);
		});
	});

	describe("migrations", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("migrations")).toBeDefined();
		});

		it("validates a valid migrations artifact", () => {
			const schema = getSchemaForType("migrations");
			const valid = {
				migrations: [
					{
						version: "001",
						description: "Initial schema",
						up: "CREATE TABLE users (id UUID PRIMARY KEY);",
						down: "DROP TABLE users;",
					},
				],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("data-contracts", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("data-contracts")).toBeDefined();
		});

		it("validates a valid data-contracts artifact", () => {
			const schema = getSchemaForType("data-contracts");
			const valid = {
				contracts: [
					{
						name: "UserContract",
						producer: "users-service",
						consumer: "auth-service",
						schema: { type: "object" },
					},
				],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});

	describe("indexing-strategy", () => {
		it("is registered in the schema registry", () => {
			expect(getSchemaForType("indexing-strategy")).toBeDefined();
		});

		it("validates a valid indexing-strategy artifact", () => {
			const schema = getSchemaForType("indexing-strategy");
			const valid = {
				indexes: [
					{
						table: "users",
						column: "email",
						type: "btree",
						rationale: "Frequent lookup by email",
					},
				],
			};
			expect(schema?.safeParse(valid).success).toBe(true);
		});
	});
});
