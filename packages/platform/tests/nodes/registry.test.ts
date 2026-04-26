import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { NodeRecord } from "@mandarnilange/agentforge-core/domain/models/node.model.js";
import type { IStateStore } from "@mandarnilange/agentforge-core/domain/ports/state-store.port.js";
import { describe, expect, it, vi } from "vitest";
import { NodeRegistry } from "../../src/nodes/registry.js";

function makeNodeDef(
	name: string,
	capabilities: string[] = ["llm-access"],
): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name, displayName: name, type: "local" },
		spec: {
			connection: { type: "local" },
			capabilities,
			resources: { maxConcurrentRuns: 2 },
		},
	};
}

describe("NodeRegistry", () => {
	it("returns all registered nodes", () => {
		const registry = new NodeRegistry([
			makeNodeDef("local"),
			makeNodeDef("remote"),
		]);
		expect(registry.getAll()).toHaveLength(2);
	});

	it("initial status is unknown", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		expect(registry.get("local")?.status).toBe("unknown");
	});

	it("marks node online", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		registry.markOnline("local");
		expect(registry.get("local")?.status).toBe("online");
	});

	it("marks node offline", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		registry.markOnline("local");
		registry.markOffline("local");
		expect(registry.get("local")?.status).toBe("offline");
	});

	it("records last heartbeat when marking online", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		registry.markOnline("local");
		expect(registry.get("local")?.lastHeartbeat).toBeDefined();
	});

	it("tracks active run count via recordRunStarted/Completed", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		registry.recordRunStarted("local");
		registry.recordRunStarted("local");
		expect(registry.get("local")?.activeRuns).toBe(2);

		registry.recordRunCompleted("local");
		expect(registry.get("local")?.activeRuns).toBe(1);
	});

	it("activeRuns does not go below 0", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		registry.recordRunCompleted("local");
		expect(registry.get("local")?.activeRuns).toBe(0);
	});

	it("get returns undefined for unknown node", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		expect(registry.get("nonexistent")).toBeUndefined();
	});

	it("lists online nodes only", () => {
		const registry = new NodeRegistry([
			makeNodeDef("a"),
			makeNodeDef("b"),
			makeNodeDef("c"),
		]);
		registry.markOnline("a");
		registry.markOffline("b");
		const online = registry.getOnline();
		expect(online).toHaveLength(1);
		expect(online[0].definition.metadata.name).toBe("a");
	});

	it("markOnline/markOffline/recordRun are no-ops for unknown nodes", () => {
		const registry = new NodeRegistry([makeNodeDef("local")]);
		expect(() => registry.markOnline("unknown")).not.toThrow();
		expect(() => registry.markOffline("unknown")).not.toThrow();
		expect(() => registry.recordRunStarted("unknown")).not.toThrow();
		expect(() => registry.recordRunCompleted("unknown")).not.toThrow();
	});

	describe("initFromStore", () => {
		function makeMockStore(nodes: Partial<NodeRecord>[] = []): IStateStore {
			return {
				listNodes: vi.fn().mockResolvedValue(
					nodes.map((n) => ({
						name: "local",
						type: "local",
						capabilities: ["llm-access"],
						status: "online",
						activeRuns: 1,
						lastHeartbeat: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
						...n,
					})),
				),
				upsertNode: vi.fn().mockResolvedValue(undefined),
			} as unknown as IStateStore;
		}

		it("restores node status from store on construction", async () => {
			const mockStore = makeMockStore([
				{
					name: "local",
					status: "online",
					activeRuns: 3,
					lastHeartbeat: "2024-06-01T00:00:00Z",
				},
			]);
			const registry = new NodeRegistry([makeNodeDef("local")], mockStore);
			// Wait for async initFromStore to complete
			await new Promise((resolve) => setTimeout(resolve, 10));

			const node = registry.get("local");
			expect(node?.status).toBe("online");
			expect(node?.activeRuns).toBe(3);
			expect(node?.lastHeartbeat).toBe("2024-06-01T00:00:00Z");
		});

		it("persists nodes to store even when not in persisted list", async () => {
			const mockStore = makeMockStore([]); // empty persisted nodes
			const _registry = new NodeRegistry([makeNodeDef("local")], mockStore);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// upsertNode should be called even for nodes not in store
			expect(mockStore.upsertNode).toHaveBeenCalled();
		});

		it("ignores persisted nodes not in current registry", async () => {
			const mockStore = makeMockStore([
				{ name: "other-node", status: "online" },
			]);
			const registry = new NodeRegistry([makeNodeDef("local")], mockStore);
			await new Promise((resolve) => setTimeout(resolve, 10));

			// "local" node should remain at default status since persisted data was for "other-node"
			const node = registry.get("local");
			expect(node?.status).toBe("unknown");
		});

		it("persists node updates when markOnline is called with a store", async () => {
			const mockStore = makeMockStore([]);
			const registry = new NodeRegistry([makeNodeDef("local")], mockStore);
			await new Promise((resolve) => setTimeout(resolve, 10));

			const callsBefore = (mockStore.upsertNode as ReturnType<typeof vi.fn>)
				.mock.calls.length;
			registry.markOnline("local");
			await new Promise((resolve) => setTimeout(resolve, 10));
			const callsAfter = (mockStore.upsertNode as ReturnType<typeof vi.fn>).mock
				.calls.length;
			expect(callsAfter).toBeGreaterThan(callsBefore);
		});
	});
});
