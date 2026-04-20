import chalk from "chalk";
import type { AgentInfo, AgentSummary } from "../agents/registry.js";

export function formatAgentTable(agents: AgentSummary[]): string {
	const header = `  ${chalk.bold("Agent".padEnd(12))}${chalk.bold("Phase".padEnd(8))}${chalk.bold("Role")}`;
	const divider = `  ${"─".repeat(10)}  ${"─".repeat(6)}${"─".repeat(34)}`;
	const rows = agents.map(
		(a) =>
			`  ${chalk.cyan(a.displayName.padEnd(12))}${a.phase.padEnd(8)}${a.role}`,
	);
	return [header, divider, ...rows].join("\n");
}

export function formatAgentInfo(info: AgentInfo): string {
	const lines = [
		"",
		`  ${chalk.bold.cyan(info.displayName)} — ${info.role} (Phase ${info.phase})`,
		`  Human Equivalent: ${info.humanEquivalent}`,
		"",
		`  ${info.description}`,
		"",
		`  Executor: ${chalk.yellow(info.executor)}`,
		`  Inputs:   ${info.inputs.join(", ") || "raw input"}`,
		`  Outputs:  ${info.outputs.join(", ")}`,
	];
	if (info.tools.length > 0) {
		lines.push(`  Tools:    ${info.tools.join(", ")}`);
	}
	lines.push("");
	return lines.join("\n");
}
