/**
 * CLI get command — query pipeline runs, agent runs, gates, and artifacts.
 * Usage: sdlc-agent get pipelines
 *        sdlc-agent get pipeline <id>
 *        sdlc-agent get gates [--pipeline <id>]
 *        sdlc-agent get gate <id>
 *        sdlc-agent get runs [--pipeline <id>]
 */

import chalk from "chalk";
import type { Command } from "commander";
import type { AgentRunRecord } from "../../domain/models/agent-run.model.js";
import type { Gate } from "../../domain/models/gate.model.js";
import type { PipelineRun } from "../../domain/models/pipeline-run.model.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";

export function registerGetCommand(program: Command, store: IStateStore): void {
	const get = program
		.command("get")
		.description("Get resources (pipelines, gates, runs)");

	get
		.command("pipelines")
		.description("List all pipeline runs")
		.action(async () => {
			const runs = await store.listPipelineRuns();
			if (runs.length === 0) {
				console.log(chalk.dim("  No pipeline runs found."));
				return;
			}
			printPipelineTable(runs);
		});

	get
		.command("pipeline <id>")
		.description("Get a specific pipeline run")
		.action(async (id: string) => {
			const run = await store.getPipelineRun(id);
			if (!run) {
				console.error(chalk.red(`Pipeline run "${id}" not found`));
				process.exit(1);
			}
			await printPipelineDetail(run, store);
		});

	get
		.command("gates")
		.description("List gates for a pipeline")
		.option("--pipeline <id>", "Filter by pipeline run ID")
		.action(async (opts: { pipeline?: string }) => {
			if (!opts.pipeline) {
				console.error(chalk.red("--pipeline <id> is required"));
				process.exit(1);
			}
			const gates = await store.listGates(opts.pipeline);
			if (gates.length === 0) {
				console.log(chalk.dim("  No gates found."));
				return;
			}
			printGateTable(gates);
		});

	get
		.command("gate <id>")
		.description("Get a specific gate")
		.action(async (id: string) => {
			const gate = await store.getGate(id);
			if (!gate) {
				console.error(chalk.red(`Gate "${id}" not found`));
				process.exit(1);
			}
			printGateDetail(gate);
		});

	get
		.command("runs")
		.description("List agent runs for a pipeline")
		.option("--pipeline <id>", "Filter by pipeline run ID")
		.action(async (opts: { pipeline?: string }) => {
			if (!opts.pipeline) {
				console.error(chalk.red("--pipeline <id> is required"));
				process.exit(1);
			}
			const runs = await store.listAgentRuns(opts.pipeline);
			if (runs.length === 0) {
				console.log(chalk.dim("  No agent runs found."));
				return;
			}
			printAgentRunTable(runs);
		});
}

function statusColor(status: string): string {
	switch (status) {
		case "running":
			return chalk.yellow(status);
		case "completed":
			return chalk.green(status);
		case "failed":
			return chalk.red(status);
		case "paused_at_gate":
			return chalk.blue(status);
		case "approved":
			return chalk.green(status);
		case "rejected":
			return chalk.red(status);
		case "revision_requested":
			return chalk.magenta(status);
		case "pending":
			return chalk.dim(status);
		case "succeeded":
			return chalk.green(status);
		default:
			return status;
	}
}

function printPipelineTable(runs: PipelineRun[]): void {
	const header = `  ${"ID".padEnd(38)}${"Session".padEnd(20)}${"Project".padEnd(20)}${"Pipeline".padEnd(20)}${"Phase".padEnd(8)}Status`;
	const divider = `  ${"─".repeat(110)}`;
	console.log(chalk.bold(header));
	console.log(divider);
	for (const r of runs) {
		console.log(
			`  ${chalk.cyan(r.id.padEnd(38))}${(r.sessionName || "—").padEnd(20)}${r.projectName.padEnd(20)}${r.pipelineName.padEnd(20)}${String(r.currentPhase).padEnd(8)}${statusColor(r.status)}`,
		);
	}
}

async function printPipelineDetail(
	run: PipelineRun,
	store: IStateStore,
): Promise<void> {
	console.log();
	console.log(`  ${chalk.bold("ID:")}          ${chalk.cyan(run.id)}`);
	console.log(
		`  ${chalk.bold("Session:")}     ${chalk.cyan(run.sessionName || run.id)}`,
	);
	console.log(`  ${chalk.bold("Project:")}     ${run.projectName}`);
	console.log(`  ${chalk.bold("Pipeline:")}    ${run.pipelineName}`);
	console.log(`  ${chalk.bold("Status:")}      ${statusColor(run.status)}`);
	console.log(`  ${chalk.bold("Phase:")}       ${run.currentPhase}`);
	console.log(`  ${chalk.bold("Started:")}     ${run.startedAt}`);
	if (run.completedAt)
		console.log(`  ${chalk.bold("Completed:")}   ${run.completedAt}`);

	const agentRuns = await store.listAgentRuns(run.id);
	if (agentRuns.length > 0) {
		console.log();
		console.log(`  ${chalk.bold("Agent Runs:")}`);
		for (const ar of agentRuns) {
			console.log(
				`    Phase ${ar.phase}  ${ar.agentName.padEnd(12)}  ${statusColor(ar.status)}`,
			);
		}
	}

	const gates = await store.listGates(run.id);
	if (gates.length > 0) {
		console.log();
		console.log(`  ${chalk.bold("Gates:")}`);
		for (const g of gates) {
			console.log(
				`    Phase ${g.phaseCompleted}→${g.phaseNext}  ${statusColor(g.status)}  ${g.id}`,
			);
		}
	}
	console.log();
}

function printGateTable(gates: Gate[]): void {
	const header = `  ${"ID".padEnd(38)}${"Phase".padEnd(12)}Status`;
	console.log(chalk.bold(header));
	console.log(`  ${"─".repeat(60)}`);
	for (const g of gates) {
		console.log(
			`  ${chalk.cyan(g.id.padEnd(38))}${`${g.phaseCompleted}→${g.phaseNext}`.padEnd(12)}${statusColor(g.status)}`,
		);
	}
}

function printGateDetail(gate: Gate): void {
	console.log();
	console.log(`  ${chalk.bold("ID:")}        ${chalk.cyan(gate.id)}`);
	console.log(`  ${chalk.bold("Pipeline:")} ${gate.pipelineRunId}`);
	console.log(
		`  ${chalk.bold("Phase:")}    ${gate.phaseCompleted} → ${gate.phaseNext}`,
	);
	console.log(`  ${chalk.bold("Status:")}   ${statusColor(gate.status)}`);
	if (gate.reviewer)
		console.log(`  ${chalk.bold("Reviewer:")} ${gate.reviewer}`);
	if (gate.comment) console.log(`  ${chalk.bold("Comment:")}  ${gate.comment}`);
	if (gate.revisionNotes)
		console.log(`  ${chalk.bold("Notes:")}    ${gate.revisionNotes}`);
	if (gate.decidedAt)
		console.log(`  ${chalk.bold("Decided:")} ${gate.decidedAt}`);
	console.log();
}

function printAgentRunTable(runs: AgentRunRecord[]): void {
	const header = `  ${"ID".padEnd(38)}${"Agent".padEnd(14)}${"Phase".padEnd(8)}${"Node".padEnd(10)}Status`;
	console.log(chalk.bold(header));
	console.log(`  ${"─".repeat(80)}`);
	for (const r of runs) {
		console.log(
			`  ${chalk.cyan(r.id.padEnd(38))}${r.agentName.padEnd(14)}${String(r.phase).padEnd(8)}${r.nodeName.padEnd(10)}${statusColor(r.status)}`,
		);
	}
}
