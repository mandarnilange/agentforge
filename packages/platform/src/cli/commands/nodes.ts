/**
 * CLI node commands — list and describe registered nodes.
 * Usage: sdlc-agent get nodes
 *        sdlc-agent describe node <name>
 */

import chalk from "chalk";
import type { Command } from "commander";
import type { NodeRegistry } from "../../nodes/registry.js";

export function registerNodesCommands(
	program: Command,
	registry: NodeRegistry,
): void {
	// sdlc-agent get nodes
	const get =
		program.commands.find((c) => c.name() === "get") ?? program.command("get");
	get
		.command("nodes")
		.description("List registered nodes and their health status")
		.action(() => {
			const nodes = registry.getAll();
			if (nodes.length === 0) {
				console.log("No nodes registered.");
				return;
			}
			console.log(
				chalk.bold(
					"\nNAME             TYPE       STATUS    ACTIVE  CAPABILITIES",
				),
			);
			console.log("─".repeat(72));
			for (const n of nodes) {
				const name = n.definition.metadata.name.padEnd(16);
				const type = (
					n.definition.metadata.type ??
					n.definition.spec.connection?.type ??
					"local"
				).padEnd(10);
				const statusColor =
					n.status === "online"
						? chalk.green
						: n.status === "offline"
							? chalk.red
							: chalk.yellow;
				const status = statusColor(n.status.padEnd(9));
				const active = String(n.activeRuns).padEnd(7);
				const caps = n.definition.spec.capabilities.join(", ");
				console.log(`${name} ${type} ${status} ${active} ${caps}`);
			}
			console.log();
		});

	// sdlc-agent describe node <name>
	const describe =
		program.commands.find((c) => c.name() === "describe") ??
		program.command("describe");
	describe
		.command("node <name>")
		.description("Show detailed information about a node")
		.action((name: string) => {
			const node = registry.get(name);
			if (!node) {
				console.error(chalk.red(`Node '${name}' not found.`));
				process.exitCode = 1;
				return;
			}
			const { definition: def } = node;
			console.log(chalk.bold(`\nNode: ${def.metadata.name}`));
			if (def.metadata.displayName)
				console.log(`  Display Name:   ${def.metadata.displayName}`);
			const connType =
				def.metadata.type ?? def.spec.connection?.type ?? "unknown";
			console.log(`  Type:           ${connType}`);
			if (def.spec.connection) {
				console.log(`  Connection:     ${def.spec.connection.type}`);
				if (def.spec.connection.host)
					console.log(`  Host:           ${def.spec.connection.host}`);
				if (def.spec.connection.user)
					console.log(`  User:           ${def.spec.connection.user}`);
			}
			console.log(`  Capabilities:   ${def.spec.capabilities.join(", ")}`);
			if (def.spec.resources?.maxConcurrentRuns != null)
				console.log(
					`  Max Concurrent: ${def.spec.resources.maxConcurrentRuns}`,
				);
			console.log(`  Status:         ${node.status}`);
			console.log(`  Active Runs:    ${node.activeRuns}`);
			if (node.lastHeartbeat)
				console.log(`  Last Heartbeat: ${node.lastHeartbeat}`);
			console.log();
		});
}
