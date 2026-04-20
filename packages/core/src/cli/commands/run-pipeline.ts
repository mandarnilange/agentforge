/**
 * CLI run command — starts a pipeline run and executes agents sequentially.
 * Usage: sdlc-agent run --project <name> --pipeline <name> [--input key=value]
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import ora from "ora";
import type { PipelineController } from "../../control-plane/pipeline-controller.js";
import { parsePipelineDefinition } from "../../definitions/parser.js";
import { resolveAgentforgeDir } from "../../di/agentforge-dir.js";
import { loadConfig } from "../../di/config.js";
import { createAgentExecutor } from "../../di/executor-factory.js";
import type { IAgentExecutor } from "../../domain/ports/agent-executor.port.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";
import { executePipeline } from "../pipeline-executor.js";

interface RunOptions {
	project: string;
	pipeline?: string;
	input?: string[];
	continue?: string;
}

export function registerRunPipelineCommand(
	program: Command,
	controller: PipelineController,
	store: IStateStore,
): void {
	program
		.command("run")
		.description("Start a pipeline run for a project")
		.option("--project <name>", "Project name")
		.option("--pipeline <name>", "Pipeline definition name", "simple-sdlc")
		.option(
			"--input <key=value>",
			"Input values (repeatable)",
			collectInputs,
			[],
		)
		.option("--continue <runId>", "Resume a paused/stuck pipeline run")
		.action(async (opts: RunOptions) => {
			let config: ReturnType<typeof loadConfig>;
			try {
				config = loadConfig();
			} catch (err) {
				const code = (err as Error & { code?: string }).code;
				if (code === "MISSING_API_KEY") {
					console.error(
						chalk.red("Configuration error: missing ANTHROPIC_API_KEY"),
					);
					console.error("");
					console.error(
						err instanceof Error ? err.message : "Missing ANTHROPIC_API_KEY",
					);
				} else {
					console.error(chalk.red("Failed to load configuration"));
					console.error(err instanceof Error ? err.message : String(err));
				}
				process.exit(1);
			}

			// Create executor based on --executor flag
			let executor: IAgentExecutor | undefined;
			try {
				executor = createAgentExecutor("local", { config });
			} catch (err) {
				console.error(
					chalk.red(
						`Executor error: ${err instanceof Error ? err.message : String(err)}`,
					),
				);
				process.exit(1);
			}

			// --- Continue an existing run ---
			if (opts.continue) {
				const existingRun = await store.getPipelineRun(opts.continue);
				if (!existingRun) {
					console.error(chalk.red(`Pipeline run not found: ${opts.continue}`));
					process.exit(1);
				}

				const pipelineName = existingRun.pipelineName;
				const pipelinePath = resolve(
					join(
						resolveAgentforgeDir(),
						"pipelines",
						`${pipelineName}.pipeline.yaml`,
					),
				);
				if (!existsSync(pipelinePath)) {
					console.error(
						chalk.red(`Pipeline definition not found: ${pipelinePath}`),
					);
					process.exit(1);
				}
				const pipelineDef = parsePipelineDefinition(
					readFileSync(pipelinePath, "utf-8"),
				);

				// Check if there's a pending gate — if so, just resume the executor loop
				// (it will detect paused_at_gate and wait). Don't re-schedule agents.
				const pendingGate = await store.getPendingGate(opts.continue);
				if (pendingGate) {
					console.log(
						chalk.yellow(
							`Pipeline is waiting at gate (Phase ${pendingGate.phaseCompleted} → ${pendingGate.phaseNext}). Approve to continue.`,
						),
					);
					return;
				}

				// Ensure pipeline is in running state
				if (
					existingRun.status === "paused_at_gate" ||
					existingRun.status === "failed"
				) {
					await store.updatePipelineRun(opts.continue, {
						status: "running",
					});
				}

				// Schedule agents for current phase if none are pending/running
				const runs = await store.listAgentRuns(opts.continue);
				const currentPhaseRuns = runs.filter(
					(r) => r.phase === existingRun.currentPhase,
				);
				const hasActiveRuns = currentPhaseRuns.some(
					(r) =>
						r.status === "pending" ||
						r.status === "running" ||
						r.status === "scheduled",
				);
				if (!hasActiveRuns && currentPhaseRuns.length === 0) {
					// No runs at all for current phase — schedule them
					await controller.schedulePhasePublic(
						opts.continue,
						existingRun.currentPhase,
						pipelineDef,
					);
				}

				const spinner = ora(
					`Resuming pipeline "${pipelineName}" from phase ${existingRun.currentPhase}...`,
				).start();
				spinner.succeed(
					chalk.green(
						`Pipeline resumed: ${opts.continue} at phase ${existingRun.currentPhase}`,
					),
				);
				console.log();

				const outputBase = join(
					config.outputDir,
					existingRun.projectName,
					existingRun.sessionName || existingRun.id,
				);
				const result = await executePipeline(
					opts.continue,
					existingRun.projectName,
					store,
					controller,
					config,
					outputBase,
					pipelineDef,
					undefined,
					executor,
				);

				const finalPipeline = await store.getPipelineRun(opts.continue);
				console.log();
				console.log(
					`  ${chalk.bold("Run ID:")}    ${chalk.cyan(opts.continue)}`,
				);
				console.log(
					`  ${chalk.bold("Session:")}   ${chalk.cyan(existingRun.sessionName || existingRun.id)}`,
				);
				console.log(`  ${chalk.bold("Project:")}   ${existingRun.projectName}`);
				console.log(
					`  ${chalk.bold("Pipeline:")}  ${existingRun.pipelineName}`,
				);
				console.log(
					`  ${chalk.bold("Status:")}    ${chalk.yellow(finalPipeline?.status ?? existingRun.status)}`,
				);
				console.log();

				if (result.pausedAtGate) {
					console.log(
						chalk.yellow(
							`Pipeline paused at gate (phase ${result.phaseCompleted} → ${result.phaseNext})`,
						),
					);
					console.log(chalk.dim(`  Gate ID: ${result.gateId}`));
					console.log(
						chalk.dim(
							`  Use 'sdlc-agent gate approve ${result.gateId}' to continue`,
						),
					);
				}
				return;
			}

			// --- Start a new run ---
			if (!opts.project) {
				console.error(
					chalk.red("--project is required when starting a new pipeline"),
				);
				process.exit(1);
			}

			const pipelineName = opts.pipeline ?? "simple-sdlc";
			const pipelinePath = resolve(
				join(
					resolveAgentforgeDir(),
					"pipelines",
					`${pipelineName}.pipeline.yaml`,
				),
			);

			if (!existsSync(pipelinePath)) {
				console.error(
					chalk.red(`Pipeline definition not found: ${pipelinePath}`),
				);
				process.exit(1);
			}

			const content = readFileSync(pipelinePath, "utf-8");
			const pipelineDef = parsePipelineDefinition(content);

			const inputs: Record<string, string> = {};
			for (const kv of opts.input ?? []) {
				const [k, ...rest] = kv.split("=");
				inputs[k] = rest.join("=");
			}

			const spinner = ora(
				`Starting pipeline "${pipelineName}" for project "${opts.project}"...`,
			).start();

			try {
				const run = await controller.startPipeline(
					opts.project,
					pipelineDef,
					inputs,
				);
				spinner.succeed(chalk.green(`Pipeline started: ${run.id}`));
				console.log();

				const outputBase = join(
					config.outputDir,
					opts.project,
					run.sessionName,
				);
				console.log(
					`  ${chalk.bold("Session:")}  ${chalk.cyan(run.sessionName)}`,
				);
				const phase1Inputs = Object.values(inputs).filter(Boolean);
				const result = await executePipeline(
					run.id,
					opts.project,
					store,
					controller,
					config,
					outputBase,
					pipelineDef,
					phase1Inputs.length > 0 ? phase1Inputs : undefined,
					executor,
				);

				const finalPipeline = await store.getPipelineRun(run.id);
				console.log();
				console.log(`  ${chalk.bold("Run ID:")}    ${chalk.cyan(run.id)}`);
				console.log(
					`  ${chalk.bold("Session:")}   ${chalk.cyan(run.sessionName)}`,
				);
				console.log(`  ${chalk.bold("Project:")}   ${run.projectName}`);
				console.log(`  ${chalk.bold("Pipeline:")}  ${run.pipelineName}`);
				console.log(
					`  ${chalk.bold("Status:")}    ${chalk.yellow(finalPipeline?.status ?? run.status)}`,
				);
				console.log();

				if (result.pausedAtGate) {
					console.log(
						chalk.yellow(
							`Pipeline paused at gate (phase ${result.phaseCompleted} → ${result.phaseNext})`,
						),
					);
					console.log(chalk.dim(`  Gate ID: ${result.gateId}`));
					console.log(
						chalk.dim(
							`  Use 'sdlc-agent gate approve ${result.gateId}' to continue`,
						),
					);
				} else {
					console.log(
						chalk.dim(
							`Use 'sdlc-agent get pipeline ${run.id}' to check status`,
						),
					);
				}
			} catch (err) {
				spinner.fail(chalk.red("Failed to run pipeline"));
				console.error(err instanceof Error ? err.message : String(err));
				process.exit(1);
			}
		});
}

function collectInputs(value: string, previous: string[]): string[] {
	return [...previous, value];
}
