import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDefinitionStore } from "../../../src/adapters/store/sqlite-definition-store.js";

const TEST_DB = "/tmp/sdlc-resource-cmd-test.db";

const AGENT_JSON = JSON.stringify({
	apiVersion: "agentforge/v1",
	kind: "AgentDefinition",
	metadata: { name: "developer", displayName: "Developer", phase: 4 },
	spec: { executor: "pi-coding-agent" },
});

describe("Resource CLI commands (P15.5-T10)", () => {
	let store: SqliteDefinitionStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteDefinitionStore(TEST_DB);
	});

	afterEach(() => {
		store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	describe("get (list definitions)", () => {
		it("lists all agent definitions", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");
			store.create(
				"AgentDefinition",
				"analyst",
				AGENT_JSON.replace("developer", "analyst"),
				"cli",
			);

			const agents = store.list("AgentDefinition");
			expect(agents).toHaveLength(2);
			expect(agents.map((a) => a.name).sort()).toEqual([
				"analyst",
				"developer",
			]);
		});
	});

	describe("describe (get single)", () => {
		it("retrieves a single definition with version and timestamps", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");

			const def = store.get("AgentDefinition", "developer");
			expect(def).not.toBeNull();
			expect(def?.name).toBe("developer");
			expect(def?.version).toBe(1);
			expect(def?.createdAt).toBeTruthy();
		});
	});

	describe("create (create-only)", () => {
		it("creates a new definition", () => {
			const def = store.create(
				"AgentDefinition",
				"developer",
				AGENT_JSON,
				"cli",
			);
			expect(def.version).toBe(1);
		});

		it("errors if definition already exists", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");
			expect(() =>
				store.create("AgentDefinition", "developer", AGENT_JSON, "cli"),
			).toThrow(); // UNIQUE constraint
		});
	});

	describe("delete", () => {
		it("deletes a definition", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");
			store.delete("AgentDefinition", "developer", "cli");

			expect(store.get("AgentDefinition", "developer")).toBeNull();
		});

		it("errors when deleting non-existent", () => {
			expect(() => store.delete("AgentDefinition", "nope", "cli")).toThrow(
				"not found",
			);
		});
	});

	describe("history", () => {
		it("shows version history", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");
			store.update(
				"AgentDefinition",
				"developer",
				`${AGENT_JSON}\n`,
				"dashboard",
			);

			const history = store.listHistory("AgentDefinition", "developer");
			expect(history).toHaveLength(2);
			expect(history[0].changeType).toBe("created");
			expect(history[1].changeType).toBe("updated");
		});
	});

	describe("rollback", () => {
		it("restores a previous version", () => {
			store.create("AgentDefinition", "developer", AGENT_JSON, "cli");
			const v1Yaml = AGENT_JSON;

			store.update(
				"AgentDefinition",
				"developer",
				'{"changed": true}',
				"dashboard",
			);
			expect(store.get("AgentDefinition", "developer")?.version).toBe(2);

			// Rollback to v1 = update with v1's content
			const history = store.listHistory("AgentDefinition", "developer");
			const v1Content = history[0].specYaml;
			store.update("AgentDefinition", "developer", v1Content, "cli");

			const restored = store.get("AgentDefinition", "developer");
			expect(restored?.version).toBe(3); // version still increments
			expect(restored?.specYaml).toBe(v1Yaml);
		});
	});
});
