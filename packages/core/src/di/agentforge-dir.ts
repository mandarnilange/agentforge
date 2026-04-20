import { join } from "node:path";

/**
 * Resolves the AgentForge definitions directory using the following precedence:
 *   1. Explicit override (e.g. from --agentforge-dir CLI flag)
 *   2. AGENTFORGE_DIR environment variable
 *   3. <cwd>/.agentforge (default)
 */
export function resolveAgentforgeDir(override?: string): string {
	return (
		override ?? process.env.AGENTFORGE_DIR ?? join(process.cwd(), ".agentforge")
	);
}
