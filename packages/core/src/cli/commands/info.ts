import type { Command } from "commander";
import { getAgentInfo, getAllAgentIds } from "../../agents/registry.js";
import { formatAgentInfo } from "../formatter.js";

export function registerInfoCommand(program: Command): void {
	program
		.command("info <agent>")
		.description("Show detailed information about an agent")
		.action((agentId: string) => {
			const info = getAgentInfo(agentId);
			if (!info) {
				console.error(
					`Unknown agent: "${agentId}". Available: ${getAllAgentIds().join(", ")}`,
				);
				process.exit(1);
			}
			console.log(formatAgentInfo(info));
		});
}
