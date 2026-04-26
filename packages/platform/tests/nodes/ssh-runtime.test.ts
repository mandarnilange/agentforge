/**
 * Tests for SshNodeRuntime using mocked child_process and net.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile, mockConnect } = vi.hoisted(() => ({
	mockExecFile: vi.fn(),
	mockConnect: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("node:net", () => ({ connect: mockConnect }));

import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import { SshNodeRuntime } from "../../src/nodes/ssh-runtime.js";

function makeNodeDef(
	overrides?: Partial<NodeDefinitionYaml["spec"]["connection"]>,
): NodeDefinitionYaml {
	return {
		apiVersion: "agentforge/v1",
		kind: "NodeDefinition",
		metadata: { name: "test-node", type: "ssh" },
		spec: {
			connection: {
				type: "ssh",
				host: "example.com",
				user: "deploy",
				...overrides,
			},
			capabilities: ["llm-access"],
			resources: { maxConcurrentRuns: 2 },
		},
	} as NodeDefinitionYaml;
}

function makeRequest() {
	return {
		runId: "run-001",
		agentId: "analyst",
		systemPrompt: "You are an analyst",
		inputArtifacts: [],
		model: { provider: "anthropic", name: "claude-sonnet" },
		outputDir: "/tmp/out",
		conversationHistory: [],
	};
}

describe("SshNodeRuntime", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("constructor", () => {
		it("uses default remote command", () => {
			const runtime = new SshNodeRuntime(makeNodeDef());
			expect(runtime).toBeDefined();
		});

		it("accepts custom remote command", () => {
			const runtime = new SshNodeRuntime(makeNodeDef(), "custom-runner");
			expect(runtime).toBeDefined();
		});
	});

	describe("ping()", () => {
		it("returns false when host is not configured", async () => {
			const nodeDef = makeNodeDef({ host: undefined });
			const runtime = new SshNodeRuntime(nodeDef);
			const result = await runtime.ping();
			expect(result).toBe(false);
		});

		it("returns true when socket connects successfully", async () => {
			const events: Record<string, () => void> = {};
			const mockSocket = {
				once: (event: string, cb: () => void) => {
					events[event] = cb;
					if (event === "connect") setTimeout(() => cb(), 0);
					return mockSocket;
				},
				destroy: vi.fn(),
			};
			mockConnect.mockReturnValue(mockSocket);

			const runtime = new SshNodeRuntime(makeNodeDef());
			const result = await runtime.ping();
			expect(result).toBe(true);
			expect(mockSocket.destroy).toHaveBeenCalled();
		});

		it("returns false when socket has error", async () => {
			const events: Record<string, () => void> = {};
			const mockSocket = {
				once: (event: string, cb: () => void) => {
					events[event] = cb;
					if (event === "error") setTimeout(() => cb(), 0);
					return mockSocket;
				},
				destroy: vi.fn(),
			};
			mockConnect.mockReturnValue(mockSocket);

			const runtime = new SshNodeRuntime(makeNodeDef());
			const result = await runtime.ping();
			expect(result).toBe(false);
		});

		it("returns false on timeout", async () => {
			const events: Record<string, () => void> = {};
			const mockSocket = {
				once: (event: string, cb: () => void) => {
					events[event] = cb;
					if (event === "timeout") setTimeout(() => cb(), 0);
					return mockSocket;
				},
				destroy: vi.fn(),
			};
			mockConnect.mockReturnValue(mockSocket);

			const runtime = new SshNodeRuntime(makeNodeDef());
			const result = await runtime.ping();
			expect(result).toBe(false);
			expect(mockSocket.destroy).toHaveBeenCalled();
		});
	});

	describe("execute()", () => {
		it("returns error when host is not configured", async () => {
			const nodeDef = makeNodeDef({ host: undefined });
			const runtime = new SshNodeRuntime(nodeDef);
			const result = await runtime.execute(makeRequest());
			expect(result.success).toBe(false);
			expect(result.error).toContain("missing host");
		});

		it("returns successful result when ssh executes correctly", async () => {
			const successResult = {
				runId: "run-001",
				success: true,
				durationMs: 500,
			};
			// promisify wraps execFile — mock the callback behavior
			mockExecFile.mockImplementation(
				(
					_cmd: string,
					_args: string[],
					_opts: object,
					callback: (err: Error | null, result: { stdout: string }) => void,
				) => {
					callback(null, { stdout: JSON.stringify(successResult) });
				},
			);

			const runtime = new SshNodeRuntime(makeNodeDef());
			const result = await runtime.execute(makeRequest());
			expect(result.success).toBe(true);
			expect(result.runId).toBe("run-001");
		});

		it("returns error result when ssh fails", async () => {
			mockExecFile.mockImplementation(
				(
					_cmd: string,
					_args: string[],
					_opts: object,
					callback: (err: Error | null, result?: { stdout: string }) => void,
				) => {
					callback(new Error("ssh: Connection refused"));
				},
			);

			const runtime = new SshNodeRuntime(makeNodeDef());
			const result = await runtime.execute(makeRequest());
			expect(result.success).toBe(false);
			expect(result.error).toContain("SSH execution failed");
		});

		it("uses user@host format when user is provided", async () => {
			const calls: string[][] = [];
			mockExecFile.mockImplementation(
				(
					_cmd: string,
					args: string[],
					_opts: object,
					callback: (err: Error | null, result: { stdout: string }) => void,
				) => {
					calls.push(args);
					callback(null, {
						stdout: JSON.stringify({
							runId: "run-001",
							success: true,
							durationMs: 100,
						}),
					});
				},
			);

			const runtime = new SshNodeRuntime(makeNodeDef());
			await runtime.execute(makeRequest());
			expect(calls[0][0]).toBe("deploy@example.com");
		});

		it("uses just host when no user", async () => {
			const calls: string[][] = [];
			mockExecFile.mockImplementation(
				(
					_cmd: string,
					args: string[],
					_opts: object,
					callback: (err: Error | null, result: { stdout: string }) => void,
				) => {
					calls.push(args);
					callback(null, {
						stdout: JSON.stringify({
							runId: "run-001",
							success: true,
							durationMs: 100,
						}),
					});
				},
			);

			const nodeDef = makeNodeDef({ user: undefined });
			const runtime = new SshNodeRuntime(nodeDef);
			await runtime.execute(makeRequest());
			expect(calls[0][0]).toBe("example.com");
		});
	});
});
