/**
 * Tests for the platform nodes CLI commands (list nodes + describe node).
 */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerNodesCommands } from "../../../src/cli/commands/nodes.js";
import type { NodeRegistry } from "../../../src/nodes/registry.js";

function makeNode(name: string, overrides = {}) {
	return {
		definition: {
			apiVersion: "agentforge/v1",
			kind: "NodeDefinition",
			metadata: { name, type: "local", displayName: `Node ${name}` },
			spec: {
				connection: { type: "local" },
				capabilities: ["llm-access", "git"],
				resources: { maxConcurrentRuns: 3 },
			},
		},
		status: "online" as const,
		activeRuns: 1,
		lastHeartbeat: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function makeMockRegistry(nodes: ReturnType<typeof makeNode>[]): NodeRegistry {
	return {
		getAll: vi.fn().mockReturnValue(nodes),
		get: vi
			.fn()
			.mockImplementation(
				(name: string) =>
					nodes.find((n) => n.definition.metadata.name === name) ?? null,
			),
		register: vi.fn(),
		update: vi.fn(),
		remove: vi.fn(),
	} as unknown as NodeRegistry;
}

async function runCommand(
	registry: NodeRegistry,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const logs: string[] = [];
	const errors: string[] = [];
	const origLog = console.log;
	const origError = console.error;
	console.log = (...a: unknown[]) => logs.push(a.join(" "));
	console.error = (...a: unknown[]) => errors.push(a.join(" "));

	const program = new Command();
	program.exitOverride();
	registerNodesCommands(program, registry);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// ignore
	} finally {
		console.log = origLog;
		console.error = origError;
	}

	return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

describe("nodes CLI commands", () => {
	describe("get nodes", () => {
		it("lists all registered nodes", async () => {
			const registry = makeMockRegistry([
				makeNode("node-1"),
				makeNode("node-2"),
			]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(registry.getAll).toHaveBeenCalled();
			expect(stdout).toContain("node-1");
			expect(stdout).toContain("node-2");
		});

		it("shows message when no nodes registered", async () => {
			const registry = makeMockRegistry([]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(stdout).toContain("No nodes");
		});

		it("shows capabilities", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(stdout).toContain("llm-access");
		});

		it("shows active runs count", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(stdout).toContain("1");
		});

		it("shows offline node with different color", async () => {
			const registry = makeMockRegistry([
				makeNode("node-1", { status: "offline" }),
			]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(stdout).toContain("offline");
		});

		it("handles degraded node status", async () => {
			const registry = makeMockRegistry([
				makeNode("node-1", { status: "degraded" }),
			]);
			const { stdout } = await runCommand(registry, ["get", "nodes"]);
			expect(stdout).toContain("degraded");
		});
	});

	describe("describe node <name>", () => {
		it("shows detailed node info", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, [
				"describe",
				"node",
				"node-1",
			]);
			expect(registry.get).toHaveBeenCalledWith("node-1");
			expect(stdout).toContain("node-1");
			expect(stdout).toContain("local");
		});

		it("shows capabilities and resources", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, [
				"describe",
				"node",
				"node-1",
			]);
			expect(stdout).toContain("llm-access");
			expect(stdout).toContain("3");
		});

		it("shows display name when present", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, [
				"describe",
				"node",
				"node-1",
			]);
			expect(stdout).toContain("Node node-1");
		});

		it("shows host/user when present", async () => {
			const nodeWithSsh = makeNode("ssh-node");
			nodeWithSsh.definition.spec.connection = {
				type: "ssh",
				host: "10.0.0.1",
				user: "ubuntu",
			} as typeof nodeWithSsh.definition.spec.connection;
			const registry = makeMockRegistry([nodeWithSsh]);
			const { stdout } = await runCommand(registry, [
				"describe",
				"node",
				"ssh-node",
			]);
			expect(stdout).toContain("10.0.0.1");
			expect(stdout).toContain("ubuntu");
		});

		it("shows last heartbeat when present", async () => {
			const registry = makeMockRegistry([makeNode("node-1")]);
			const { stdout } = await runCommand(registry, [
				"describe",
				"node",
				"node-1",
			]);
			expect(stdout).toContain("2024-01-01");
		});

		it("shows error for unknown node", async () => {
			const registry = makeMockRegistry([]);
			const { stderr } = await runCommand(registry, [
				"describe",
				"node",
				"unknown",
			]);
			expect(stderr).toContain("not found");
		});
	});
});
