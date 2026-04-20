import type { Command } from "commander";
import { getAgentList } from "../../agents/registry.js";
import { formatAgentTable } from "../formatter.js";

export function registerListCommand(program: Command): void {
	program
		.command("list")
		.description("List all available SDLC agents")
		.action(() => {
			const agents = getAgentList();
			console.log(formatAgentTable(agents));
		});
}
