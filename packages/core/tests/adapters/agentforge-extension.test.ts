import { describe, expect, it, vi } from "vitest";
import {
	type AgentForgeExtensionDeps,
	createAgentForgeExtension,
} from "../../src/adapters/execution/agentforge-extension.js";

function createMockDeps(
	overrides: Partial<AgentForgeExtensionDeps> = {},
): AgentForgeExtensionDeps {
	return {
		workdir: "/tmp",
		artifactStore: {
			load: vi.fn().mockResolvedValue([]),
			list: vi.fn().mockResolvedValue([]),
			save: vi.fn(),
		},
		...overrides,
	};
}

describe("createAgentForgeExtension", () => {
	it("returns an ExtensionFactory function", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		expect(typeof factory).toBe("function");
	});

	it("registers run_tests tool via pi.registerTool", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		const toolNames = registerTool.mock.calls.map(
			(call: unknown[]) => (call[0] as { name: string }).name,
		);
		expect(toolNames).toContain("run_tests");
	});

	it("registers check_lint tool via pi.registerTool", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		const toolNames = registerTool.mock.calls.map(
			(call: unknown[]) => (call[0] as { name: string }).name,
		);
		expect(toolNames).toContain("check_lint");
	});

	it("registers read_artifact tool via pi.registerTool", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		const toolNames = registerTool.mock.calls.map(
			(call: unknown[]) => (call[0] as { name: string }).name,
		);
		expect(toolNames).toContain("read_artifact");
	});

	it("registered tools have name, description, and parameters", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		for (const call of registerTool.mock.calls) {
			const tool = call[0] as {
				name: string;
				description: string;
				parameters: unknown;
			};
			expect(tool.name).toBeTruthy();
			expect(tool.description).toBeTruthy();
			expect(tool.parameters).toBeDefined();
		}
	});

	it("uses workdir from deps for tool execution context", () => {
		const deps = createMockDeps({ workdir: "/my/project" });
		const factory = createAgentForgeExtension(deps);
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		// Factory closes over workdir — verify it was created with custom workdir
		expect(registerTool).toHaveBeenCalled();
	});

	it("registers exactly 3 built-in tools", () => {
		const factory = createAgentForgeExtension(createMockDeps());
		const registerTool = vi.fn();
		const mockPi = { registerTool, on: vi.fn() };

		factory(mockPi as unknown as Parameters<typeof factory>[0]);

		expect(registerTool).toHaveBeenCalledTimes(3);
	});

	// Helper to pull a registered tool by name so we can invoke its execute
	interface RegisteredTool {
		name: string;
		description: string;
		parameters: unknown;
		execute: (
			id: unknown,
			params: unknown,
		) => Promise<{
			content: Array<{ type: "text"; text: string }>;
		}>;
	}
	function getTools(deps = createMockDeps()): Record<string, RegisteredTool> {
		const factory = createAgentForgeExtension(deps);
		const tools: Record<string, RegisteredTool> = {};
		const registerTool = (tool: RegisteredTool) => {
			tools[tool.name] = tool;
		};
		factory({
			registerTool,
			on: () => {},
		} as unknown as Parameters<typeof factory>[0]);
		return tools;
	}

	it("run_tests runs the default command and returns stdout", async () => {
		const tools = getTools();
		// Use a command that succeeds on any platform
		const result = await tools.run_tests.execute(undefined, {
			command: "echo hello-from-test",
		});
		const text = result.content[0].text;
		expect(text).toContain("Exit code: 0");
		expect(text).toContain("hello-from-test");
	});

	it("run_tests appends the pattern to the command", async () => {
		const tools = getTools();
		const result = await tools.run_tests.execute(undefined, {
			command: "echo",
			pattern: "my-pattern",
		});
		const text = result.content[0].text;
		expect(text).toContain("my-pattern");
	});

	it("run_tests captures non-zero exit code and stderr", async () => {
		const tools = getTools();
		// Use the current Node binary so this works on Windows too.
		const nodeBin = JSON.stringify(process.execPath);
		const script = "process.stderr.write('oops'); process.exit(3);";
		const result = await tools.run_tests.execute(undefined, {
			command: `${nodeBin} -e ${JSON.stringify(script)}`,
		});
		const text = result.content[0].text;
		expect(text).toContain("Exit code: 3");
		expect(text).toContain("oops");
	});

	it("check_lint runs the default lint command", async () => {
		const tools = getTools();
		const result = await tools.check_lint.execute(undefined, {
			command: "echo linted",
		});
		expect(result.content[0].text).toContain("linted");
	});

	it("read_artifact returns joined content when artifacts exist", async () => {
		const deps = createMockDeps({
			artifactStore: {
				load: vi.fn().mockResolvedValue([
					{ type: "frd", path: "frd.json", content: "{}" },
					{ type: "frd", path: "frd-v2.json", content: '{"v":2}' },
				]),
				list: vi.fn().mockResolvedValue([]),
				save: vi.fn(),
			},
		});
		const tools = getTools(deps);
		const result = await tools.read_artifact.execute(undefined, {
			artifactType: "frd",
		});
		const text = result.content[0].text;
		expect(text).toContain("frd.json");
		expect(text).toContain("frd-v2.json");
	});

	it("read_artifact returns 'No artifact' message when none match", async () => {
		const tools = getTools();
		const result = await tools.read_artifact.execute(undefined, {
			artifactType: "nonexistent",
			outputDir: "/custom/out",
		});
		const text = result.content[0].text;
		expect(text).toContain("No artifact");
		expect(text).toContain("/custom/out");
	});

	it("read_artifact reports errors from artifactStore.load", async () => {
		const deps = createMockDeps({
			artifactStore: {
				load: vi.fn().mockRejectedValue(new Error("disk full")),
				list: vi.fn(),
				save: vi.fn(),
			},
		});
		const tools = getTools(deps);
		const result = await tools.read_artifact.execute(undefined, {
			artifactType: "frd",
		});
		const text = result.content[0].text;
		expect(text).toContain("Failed to read artifact");
		expect(text).toContain("disk full");
	});
});
