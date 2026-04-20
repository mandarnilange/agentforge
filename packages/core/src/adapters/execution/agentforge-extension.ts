/**
 * AgentForge bridge extension factory — closes over DI dependencies
 * and registers built-in skill tools (run_tests, check_lint, read_artifact)
 * that pi-coding-agent agents can call during execution.
 */

import { execSync } from "node:child_process";
import type { IArtifactStore } from "../../domain/ports/artifact-store.port.js";

/** Dependencies injected from the DI container via closure. */
export interface AgentForgeExtensionDeps {
	readonly workdir: string;
	readonly artifactStore: IArtifactStore;
}

/**
 * Minimal subset of the pi-coding-agent ExtensionAPI used for tool registration.
 * Avoids importing the full type to keep core decoupled from pi-coding-agent types.
 */
interface ExtensionAPISubset {
	registerTool(tool: {
		name: string;
		description: string;
		parameters: Record<string, unknown>;
		execute: (...args: unknown[]) => Promise<unknown>;
	}): void;
	on(event: string, handler: (...args: unknown[]) => void): void;
}

/** Tool result shape matching pi-coding-agent AgentToolResult. */
interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
}

/**
 * Run a shell command and return structured result.
 * Commands come from agent YAML config (not runtime user input),
 * and require shell features for pipes and arg passing.
 */
function runShellCommand(
	cmd: string,
	cwd: string,
	timeoutMs: number,
): ToolResult {
	try {
		const stdout = execSync(cmd, {
			cwd,
			encoding: "utf-8",
			timeout: timeoutMs,
			stdio: ["pipe", "pipe", "pipe"],
		});
		return {
			content: [{ type: "text", text: `Exit code: 0\n\n${stdout}` }],
		};
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; status?: number };
		return {
			content: [
				{
					type: "text",
					text: `Exit code: ${e.status ?? 1}\n\nSTDOUT:\n${e.stdout ?? ""}\n\nSTDERR:\n${e.stderr ?? ""}`,
				},
			],
		};
	}
}

/**
 * Creates an extension factory that registers AgentForge-aware skill tools.
 * The returned function follows the pi-coding-agent ExtensionFactory signature:
 *   (pi: ExtensionAPI) => void
 */
export function createAgentForgeExtension(
	deps: AgentForgeExtensionDeps,
): (pi: ExtensionAPISubset) => void {
	return (pi: ExtensionAPISubset) => {
		pi.registerTool({
			name: "run_tests",
			description:
				"Run the project test suite. Returns stdout/stderr and exit code. Optionally filter by test file pattern.",
			parameters: {
				type: "object",
				properties: {
					command: {
						type: "string",
						description:
							'Test command to run (default: "npm test"). Override for custom test runners.',
					},
					pattern: {
						type: "string",
						description:
							"Optional file pattern to filter tests (e.g. 'src/utils')",
					},
				},
			},
			async execute(
				_toolCallId: unknown,
				params: unknown,
			): Promise<ToolResult> {
				const { command, pattern } = (params ?? {}) as {
					command?: string;
					pattern?: string;
				};
				const baseCmd = command ?? "npm test";
				const fullCmd = pattern ? `${baseCmd} -- ${pattern}` : baseCmd;
				return runShellCommand(fullCmd, deps.workdir, 120_000);
			},
		});

		pi.registerTool({
			name: "check_lint",
			description:
				"Run the project linter. Returns lint violations and exit code.",
			parameters: {
				type: "object",
				properties: {
					command: {
						type: "string",
						description: 'Lint command to run (default: "npx biome check .").',
					},
				},
			},
			async execute(
				_toolCallId: unknown,
				params: unknown,
			): Promise<ToolResult> {
				const { command } = (params ?? {}) as { command?: string };
				const cmd = command ?? "npx biome check .";
				return runShellCommand(cmd, deps.workdir, 60_000);
			},
		});

		pi.registerTool({
			name: "read_artifact",
			description:
				"Read an artifact produced by another AgentForge agent. Returns the artifact content as text.",
			parameters: {
				type: "object",
				properties: {
					artifactType: {
						type: "string",
						description:
							"The artifact type to read (e.g. 'frd', 'architecture', 'sprint-plan')",
					},
					outputDir: {
						type: "string",
						description:
							"Directory to read from (defaults to the agent workdir)",
					},
				},
				required: ["artifactType"],
			},
			async execute(
				_toolCallId: unknown,
				params: unknown,
			): Promise<ToolResult> {
				const { artifactType, outputDir } = (params ?? {}) as {
					artifactType: string;
					outputDir?: string;
				};
				const dir = outputDir ?? deps.workdir;

				try {
					const artifacts = await deps.artifactStore.load({
						type: artifactType as import("../../domain/models/artifact.model.js").ArtifactType,
					});
					if (artifacts.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: `No artifact of type "${artifactType}" found in ${dir}`,
								},
							],
						};
					}
					const text = artifacts
						.map((a) => `--- ${a.path} ---\n${a.content}`)
						.join("\n\n");
					return { content: [{ type: "text", text }] };
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						content: [
							{
								type: "text",
								text: `Failed to read artifact "${artifactType}": ${msg}`,
							},
						],
					};
				}
			},
		});
	};
}
