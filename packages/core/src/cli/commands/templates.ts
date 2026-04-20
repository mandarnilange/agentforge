import type { Command } from "commander";
import { getCoreTemplates } from "../../templates/registry.js";

export function registerTemplatesCommand(
	program: Command,
	extraTemplates: import("../../templates/registry.js").TemplateManifest[] = [],
): void {
	const templates = program
		.command("templates")
		.description("Manage and list available AgentForge templates");

	templates
		.command("list")
		.description("List all available templates")
		.action(() => {
			const all = [...getCoreTemplates(), ...extraTemplates];

			console.log("\nAvailable templates:\n");
			console.log(
				`  ${"NAME".padEnd(22)} ${"AGENTS".padEnd(8)} ${"EXECUTOR".padEnd(10)} DESCRIPTION`,
			);
			console.log(`  ${"-".repeat(80)}`);

			for (const t of all) {
				const name = t.name.padEnd(22);
				const agents = String(t.agents ?? "").padEnd(8);
				const executor = (t.executor ?? "").padEnd(10);
				const description = t.description ?? "";
				console.log(`  ${name} ${agents} ${executor} ${description}`);
			}

			console.log("\nUsage: agentforge init --template <name>\n");
		});
}
