import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type { INodeRuntime } from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";
import { describe, expect, it, vi } from "vitest";
import { NodeHealthChecker } from "../../src/nodes/health-check.js";
import { NodeRegistry } from "../../src/nodes/registry.js";

function makeNodeDef(name: string): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name, type: "local" },
		spec: { connection: { type: "local" }, capabilities: ["llm-access"] },
	};
}

function makeRuntime(name: string, pingResult: boolean): INodeRuntime {
	const def = makeNodeDef(name);
	return {
		nodeDefinition: def,
		ping: vi.fn().mockResolvedValue(pingResult),
		execute: vi.fn(),
	};
}

describe("NodeHealthChecker", () => {
	it("marks node online when ping returns true", async () => {
		const runtime = makeRuntime("local", true);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		await checker.checkAll();

		expect(registry.get("local")?.status).toBe("online");
	});

	it("marks node offline when ping returns false", async () => {
		const runtime = makeRuntime("remote", false);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		await checker.checkAll();

		expect(registry.get("remote")?.status).toBe("offline");
	});

	it("checkAll updates all nodes", async () => {
		const r1 = makeRuntime("n1", true);
		const r2 = makeRuntime("n2", false);
		const registry = new NodeRegistry([r1.nodeDefinition, r2.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [r1, r2]);

		await checker.checkAll();

		expect(registry.get("n1")?.status).toBe("online");
		expect(registry.get("n2")?.status).toBe("offline");
	});

	it("checkOne returns online status for reachable node", async () => {
		const runtime = makeRuntime("local", true);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		const status = await checker.checkOne("local");

		expect(status).toBe("online");
	});

	it("checkOne returns offline status for unreachable node", async () => {
		const runtime = makeRuntime("remote", false);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		const status = await checker.checkOne("remote");

		expect(status).toBe("offline");
	});

	it("startInterval returns a stop function", () => {
		const runtime = makeRuntime("local", true);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		const stop = checker.startInterval(60000);
		expect(typeof stop).toBe("function");
		stop();
	});

	it("startInterval fires checkAll when interval elapses (covers line 46)", async () => {
		const runtime = makeRuntime("local", true);
		const registry = new NodeRegistry([runtime.nodeDefinition]);
		const checker = new NodeHealthChecker(registry, [runtime]);

		const stop = checker.startInterval(10);
		// Wait for at least one interval to fire
		await new Promise((resolve) => setTimeout(resolve, 40));
		stop();

		// ping should have been called at least once by the interval callback
		expect(runtime.ping).toHaveBeenCalled();
	});
});
