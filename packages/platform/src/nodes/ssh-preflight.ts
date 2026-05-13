/**
 * SSH preflight validation (P40-T6).
 *
 * On platform startup, every node whose connection.type is "ssh" gets a
 * lightweight TCP/SSH reach check. Unreachable nodes are marked offline in
 * the registry and surfaced as a startup warning so operators learn about
 * misconfigured hosts immediately rather than via a cryptic dispatch failure
 * minutes later.
 *
 * The actual probe is delegated to the runtime's `ping()` (already
 * implemented in SshNodeRuntime) so the policy here is just: who do we
 * probe, what do we do with the result, and how do we report it.
 */

import type { INodeRuntime } from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";

export interface SshPreflightOptions {
	runtimes: readonly INodeRuntime[];
	warn: (msg: string) => void;
	markOffline: (nodeName: string) => void;
}

export interface SshPreflightResult {
	name: string;
	reachable: boolean;
}

export async function validateSshNodesAtStartup(
	opts: SshPreflightOptions,
): Promise<SshPreflightResult[]> {
	const sshRuntimes = opts.runtimes.filter(
		(r) => r.nodeDefinition.spec.connection?.type === "ssh",
	);
	const checks = await Promise.all(
		sshRuntimes.map(async (rt) => {
			const name = rt.nodeDefinition.metadata.name;
			const host = rt.nodeDefinition.spec.connection?.host ?? "<unknown>";
			let reachable = false;
			try {
				reachable = await rt.ping();
			} catch {
				reachable = false;
			}
			if (!reachable) {
				opts.markOffline(name);
				opts.warn(
					`SSH node "${name}" at ${host} is unreachable — marking offline. ` +
						"Verify host, port, key, and connection.user before scheduling.",
				);
			}
			return { name, reachable };
		}),
	);
	return checks;
}
