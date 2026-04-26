/**
 * Tests for PgDefinitionStore using a mocked pg.Pool.
 * Mirrors the surface area of SqliteDefinitionStore so the two adapters
 * have the same behavioural contract.
 */

import type {
	AgentDefinitionYaml,
	NodeDefinitionYaml,
	PipelineDefinitionYaml,
} from "@mandarnilange/agentforge-core/definitions/parser.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockQuery, mockEnd } = vi.hoisted(() => ({
	mockQuery: vi.fn(),
	mockEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("pg", () => {
	class MockPool {
		query = mockQuery;
		end = mockEnd;
		async connect() {
			return {
				query: mockQuery,
				release: () => {},
			};
		}
	}
	return { default: { Pool: MockPool } };
});

import { PgDefinitionStore } from "../../../src/adapters/store/pg-definition-store.js";

const AGENT_YAML = `apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: developer
spec:
  executor: pi-coding-agent`;

const PIPELINE_YAML = `apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: standard-sdlc
spec:
  phases: []`;

const NODE_YAML = `apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: local
  type: local
spec:
  capabilities: [llm-access]`;

function defRow(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "def-1",
		kind: "AgentDefinition",
		name: "developer",
		version: 1,
		spec_yaml: AGENT_YAML,
		metadata: null,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function histRow(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "hist-1",
		definition_id: "def-1",
		version: 1,
		spec_yaml: AGENT_YAML,
		changed_by: "cli",
		change_type: "created",
		created_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("PgDefinitionStore", () => {
	let store: PgDefinitionStore;

	beforeEach(() => {
		vi.clearAllMocks();
		store = new PgDefinitionStore("postgresql://localhost/test");
	});

	describe("lifecycle", () => {
		it("initialize() runs migrations that create the schema", async () => {
			mockQuery.mockResolvedValue({ rows: [] });
			await store.initialize();
			const sqls = mockQuery.mock.calls
				.map((c) => c[0])
				.filter((s): s is string => typeof s === "string");
			expect(sqls.some((s) => s.includes("CREATE TABLE"))).toBe(true);
			expect(sqls.some((s) => s.includes("schema_migrations"))).toBe(true);
		});

		it("preflight() runs SELECT 1", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
			await store.preflight();
			expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
		});

		it("preflight() wraps pg errors with a friendly message", async () => {
			mockQuery.mockRejectedValueOnce(new Error("ECONNREFUSED"));
			await expect(store.preflight()).rejects.toThrow(/preflight failed/i);
		});

		it("close() ends the pool", async () => {
			await store.close();
			expect(mockEnd).toHaveBeenCalled();
		});
	});

	describe("create", () => {
		it("inserts definition + history and returns version=1", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [] }) // INSERT resource_definitions
				.mockResolvedValueOnce({ rows: [] }); // INSERT resource_definition_history
			const def = await store.create(
				"AgentDefinition",
				"developer",
				AGENT_YAML,
				"cli",
			);
			expect(def.kind).toBe("AgentDefinition");
			expect(def.name).toBe("developer");
			expect(def.version).toBe(1);
			expect(def.specYaml).toBe(AGENT_YAML);
			expect(def.id).toMatch(/^[0-9a-f-]{36}$/);

			expect(mockQuery).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("INSERT INTO resource_definitions"),
				expect.any(Array),
			);
			expect(mockQuery).toHaveBeenNthCalledWith(
				2,
				expect.stringContaining("INSERT INTO resource_definition_history"),
				expect.any(Array),
			);
		});
	});

	describe("get", () => {
		it("returns the definition when found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [defRow()] });
			const def = await store.get("AgentDefinition", "developer");
			expect(def?.name).toBe("developer");
			expect(def?.specYaml).toBe(AGENT_YAML);
			expect(def?.version).toBe(1);
		});

		it("returns null when missing", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.get("AgentDefinition", "ghost")).toBeNull();
		});
	});

	describe("list", () => {
		it("returns definitions ordered by name", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [
					defRow({ name: "analyst" }),
					defRow({ name: "developer", id: "def-2" }),
				],
			});
			const defs = await store.list("AgentDefinition");
			expect(defs).toHaveLength(2);
			expect(defs[0].name).toBe("analyst");
		});
	});

	describe("update", () => {
		it("bumps version and writes history entry with changeType=updated", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [defRow({ version: 1 })] }) // get existing
				.mockResolvedValueOnce({ rows: [] }) // UPDATE resource_definitions
				.mockResolvedValueOnce({ rows: [] }); // INSERT history

			const updated = await store.update(
				"AgentDefinition",
				"developer",
				`${AGENT_YAML}\n# v2`,
				"dashboard",
			);

			expect(updated.version).toBe(2);
			expect(updated.specYaml).toContain("# v2");
			expect(mockQuery).toHaveBeenNthCalledWith(
				3,
				expect.stringContaining("INSERT INTO resource_definition_history"),
				expect.arrayContaining(["updated"]),
			);
		});

		it("throws when the definition does not exist", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await expect(
				store.update("AgentDefinition", "ghost", AGENT_YAML, "cli"),
			).rejects.toThrow(/not found/);
		});
	});

	describe("upsert", () => {
		it("creates when absent", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [] }) // get -> null
				.mockResolvedValueOnce({ rows: [] }) // INSERT def
				.mockResolvedValueOnce({ rows: [] }); // INSERT history
			const def = await store.upsert(
				"AgentDefinition",
				"developer",
				AGENT_YAML,
				"cli",
			);
			expect(def.version).toBe(1);
		});

		it("updates when present", async () => {
			// Use a DIFFERENT specYaml than the existing record so update fires
			mockQuery
				.mockResolvedValueOnce({ rows: [defRow({ version: 3 })] }) // get (for upsert)
				.mockResolvedValueOnce({ rows: [defRow({ version: 3 })] }) // get (inside update)
				.mockResolvedValueOnce({ rows: [] }) // UPDATE
				.mockResolvedValueOnce({ rows: [] }); // INSERT history
			const def = await store.upsert(
				"AgentDefinition",
				"developer",
				`${AGENT_YAML}\n# changed`,
				"cli",
			);
			expect(def.version).toBe(4);
		});

		it("recovers from a concurrent-create race (PG unique_violation 23505)", async () => {
			// Race: get() returns null (no existing record), but by the time
			// create() INSERTs, another process has already inserted the row.
			// Result: PG throws unique_violation (code 23505). upsert() should
			// re-fetch and decide: byte-identical → return; differs → update.
			const winnerYaml = AGENT_YAML;
			const winnerRow = defRow({ version: 1, spec_yaml: winnerYaml });
			const uniqueViolation = Object.assign(
				new Error('duplicate key value violates unique constraint "..."'),
				{ code: "23505" },
			);

			mockQuery
				.mockResolvedValueOnce({ rows: [] }) // get() inside upsert → null
				.mockRejectedValueOnce(uniqueViolation) // INSERT (create) → 23505
				.mockResolvedValueOnce({ rows: [winnerRow] }); // re-fetch → existing

			const def = await store.upsert(
				"AgentDefinition",
				"developer",
				winnerYaml,
				"boot",
			);
			// Same content as the row that won the race → no version bump.
			expect(def.version).toBe(1);
			// Three queries: initial get, failed INSERT, post-conflict get.
			// No UPDATE issued.
			expect(mockQuery).toHaveBeenCalledTimes(3);
		});

		it("is a no-op when spec_yaml is byte-identical to the existing record", async () => {
			// Existing record has the SAME spec_yaml as the upsert input
			mockQuery.mockResolvedValueOnce({
				rows: [defRow({ version: 5, spec_yaml: AGENT_YAML })],
			});
			const def = await store.upsert(
				"AgentDefinition",
				"developer",
				AGENT_YAML,
				"boot",
			);
			expect(def.version).toBe(5); // no bump
			// Only one query — the get(); no UPDATE, no INSERT history
			expect(mockQuery).toHaveBeenCalledTimes(1);
		});
	});

	describe("delete", () => {
		it("writes a history row then removes the definition", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [defRow({ version: 2 })] }) // get existing
				.mockResolvedValueOnce({ rows: [] }) // INSERT history
				.mockResolvedValueOnce({ rows: [] }); // DELETE

			await store.delete("AgentDefinition", "developer", "cli");

			expect(mockQuery).toHaveBeenNthCalledWith(
				2,
				expect.stringContaining("INSERT INTO resource_definition_history"),
				expect.arrayContaining(["deleted"]),
			);
			expect(mockQuery).toHaveBeenNthCalledWith(
				3,
				expect.stringContaining("DELETE FROM resource_definitions"),
				expect.any(Array),
			);
		});

		it("throws when the definition does not exist", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await expect(
				store.delete("AgentDefinition", "ghost", "cli"),
			).rejects.toThrow(/not found/);
		});
	});

	describe("listHistory", () => {
		it("returns history rows sorted by version", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [defRow()] }) // get id for lookup
				.mockResolvedValueOnce({
					rows: [
						histRow({ version: 1, change_type: "created" }),
						histRow({
							id: "hist-2",
							version: 2,
							change_type: "updated",
							changed_by: "dashboard",
						}),
					],
				});
			const hist = await store.listHistory("AgentDefinition", "developer");
			expect(hist).toHaveLength(2);
			expect(hist[0].version).toBe(1);
			expect(hist[1].changeType).toBe("updated");
			expect(hist[1].changedBy).toBe("dashboard");
		});

		it("returns [] when definition is missing", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const hist = await store.listHistory("AgentDefinition", "ghost");
			expect(hist).toEqual([]);
		});
	});

	describe("all three kinds", () => {
		it("accepts pipeline + node definitions as well", async () => {
			mockQuery.mockResolvedValue({ rows: [] });
			await store.create("PipelineDefinition", "std", PIPELINE_YAML, "cli");
			await store.create("NodeDefinition", "local", NODE_YAML, "cli");
			const pipelineInsertCall = mockQuery.mock.calls.find(
				([sql, params]) =>
					typeof sql === "string" &&
					sql.includes("INSERT INTO resource_definitions") &&
					Array.isArray(params) &&
					params.includes("PipelineDefinition"),
			);
			const nodeInsertCall = mockQuery.mock.calls.find(
				([sql, params]) =>
					typeof sql === "string" &&
					sql.includes("INSERT INTO resource_definitions") &&
					Array.isArray(params) &&
					params.includes("NodeDefinition"),
			);
			expect(pipelineInsertCall).toBeDefined();
			expect(nodeInsertCall).toBeDefined();
		});
	});

	describe("upsertFromYamlObject helpers (for platform-cli YAML boot loop)", () => {
		it("upsertAgent serialises the yaml object to JSON and upserts", async () => {
			mockQuery
				.mockResolvedValueOnce({ rows: [] }) // get -> null (not existing)
				.mockResolvedValueOnce({ rows: [] }) // INSERT
				.mockResolvedValueOnce({ rows: [] }); // INSERT history
			const agent: AgentDefinitionYaml = {
				apiVersion: "agentforge/v1",
				kind: "AgentDefinition",
				metadata: { name: "developer" },
				spec: { executor: "pi-coding-agent" },
			};
			await store.upsertAgent(agent, "boot");
			const params = mockQuery.mock.calls[1][1] as unknown[];
			const specYaml = params.find(
				(p) => typeof p === "string" && p.includes('"developer"'),
			);
			expect(specYaml).toBeDefined();
		});

		it("upsertPipeline + upsertNode also delegate to upsert", async () => {
			mockQuery.mockResolvedValue({ rows: [] });
			const pipeline: PipelineDefinitionYaml = {
				apiVersion: "agentforge/v1",
				kind: "PipelineDefinition",
				metadata: { name: "standard-sdlc" },
				spec: { phases: [] },
			};
			const node: NodeDefinitionYaml = {
				apiVersion: "agentforge/v1",
				kind: "NodeDefinition",
				metadata: { name: "local", type: "local" },
				spec: { connection: { type: "local" }, capabilities: ["llm-access"] },
			};
			await store.upsertPipeline(pipeline, "boot");
			await store.upsertNode(node, "boot");
			const kindsInserted = mockQuery.mock.calls
				.filter(([sql]) =>
					typeof sql === "string"
						? sql.includes("INSERT INTO resource_definitions")
						: false,
				)
				.map(([, params]) =>
					Array.isArray(params) ? (params as unknown[])[1] : null,
				);
			expect(kindsInserted).toContain("PipelineDefinition");
			expect(kindsInserted).toContain("NodeDefinition");
		});
	});
});
