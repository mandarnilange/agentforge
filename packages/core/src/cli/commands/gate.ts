/**
 * CLI gate command — approve, reject, or request revision on a gate.
 * Usage: sdlc-agent gate approve <id> [--reviewer <name>] [--comment <text>]
 *        sdlc-agent gate reject <id> [--reviewer <name>] [--comment <text>]
 *        sdlc-agent gate revise <id> --notes <text> [--reviewer <name>]
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { getRuntimeDefinitionStore } from "../../agents/definition-source.js";
import type { PipelineController } from "../../control-plane/pipeline-controller.js";
import { parsePipelineDefinition } from "../../definitions/parser.js";
import { resolveAgentforgeDir } from "../../di/agentforge-dir.js";
import { loadConfig } from "../../di/config.js";
import { createAgentExecutor } from "../../di/executor-factory.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";
import { executePipeline } from "../pipeline-executor.js";

export function registerGateCommand(
	program: Command,
	store: IStateStore,
	controller: PipelineController,
): void {
	const gate = program.command("gate").description("Manage pipeline gates");

	gate
		.command("approve <id>")
		.description("Approve a gate and advance the pipeline")
		.option("--reviewer <name>", "Reviewer name")
		.option("--comment <text>", "Approval comment")
		.action(
			async (id: string, opts: { reviewer?: string; comment?: string }) => {
				const gateRecord = await store.getGate(id);
				if (!gateRecord) {
					console.error(chalk.red(`Gate "${id}" not found`));
					process.exit(1);
				}

				if (gateRecord.status !== "pending") {
					console.error(
						chalk.red(
							`Gate "${id}" is not pending (status: ${gateRecord.status})`,
						),
					);
					process.exit(1);
				}

				const pipeline = await store.getPipelineRun(gateRecord.pipelineRunId);
				if (!pipeline) {
					console.error(
						chalk.red(`Pipeline run "${gateRecord.pipelineRunId}" not found`),
					);
					process.exit(1);
				}

				const pipelineDef = loadPipelineDef(pipeline.pipelineName);
				if (!pipelineDef) {
					console.error(
						chalk.red(
							`Pipeline definition "${pipeline.pipelineName}" not found on disk`,
						),
					);
					process.exit(1);
				}

				try {
					await controller.approveGate(
						id,
						pipelineDef,
						opts.reviewer,
						opts.comment,
					);
					const updated = await store.getPipelineRun(pipeline.id);
					console.log(chalk.green("Gate approved."));
					console.log(
						`  Pipeline status: ${chalk.cyan(updated?.status ?? "unknown")}`,
					);

					if (updated?.status === "running") {
						console.log(
							`  Advancing to phase ${chalk.bold(String(updated.currentPhase))}`,
						);

						let config: ReturnType<typeof loadConfig>;
						try {
							config = loadConfig();
						} catch {
							console.log(
								chalk.dim(
									"No API key configured — agents scheduled but not executed.",
								),
							);
							console.log(
								chalk.dim(
									`  Use 'sdlc-agent run --project ${pipeline.projectName}' to resume.`,
								),
							);
							return;
						}

						const outputBase = join(
							config.outputDir,
							pipeline.projectName,
							pipeline.sessionName || pipeline.id,
						);
						const executor = createAgentExecutor("local", { config });
						const result = await executePipeline(
							pipeline.id,
							pipeline.projectName,
							store,
							controller,
							config,
							outputBase,
							pipelineDef,
							undefined,
							executor,
						);

						if (result.pausedAtGate) {
							console.log(
								chalk.yellow(
									`Pipeline paused at next gate (phase ${result.phaseCompleted} → ${result.phaseNext})`,
								),
							);
							console.log(
								chalk.dim(
									`  Use 'sdlc-agent gate approve ${result.gateId}' to continue`,
								),
							);
						}
					} else if (updated?.status === "completed") {
						console.log(chalk.green("  Pipeline completed!"));
					}
				} catch (err) {
					console.error(
						chalk.red(err instanceof Error ? err.message : String(err)),
					);
					process.exit(1);
				}
			},
		);

	gate
		.command("reject <id>")
		.description("Reject a gate and fail the pipeline")
		.option("--reviewer <name>", "Reviewer name")
		.option("--comment <text>", "Rejection reason")
		.action(
			async (id: string, opts: { reviewer?: string; comment?: string }) => {
				const gateRecord = await store.getGate(id);
				if (!gateRecord) {
					console.error(chalk.red(`Gate "${id}" not found`));
					process.exit(1);
				}

				try {
					await controller.rejectGate(id, opts.reviewer, opts.comment);
					console.log(chalk.red("Gate rejected. Pipeline has been failed."));
				} catch (err) {
					console.error(
						chalk.red(err instanceof Error ? err.message : String(err)),
					);
					process.exit(1);
				}
			},
		);

	gate
		.command("revise <id>")
		.description("Request revision on a gate")
		.requiredOption("--notes <text>", "Revision notes for the agent")
		.option("--reviewer <name>", "Reviewer name")
		.action(async (id: string, opts: { notes: string; reviewer?: string }) => {
			const gateRecord = await store.getGate(id);
			if (!gateRecord) {
				console.error(chalk.red(`Gate "${id}" not found`));
				process.exit(1);
			}

			const pipeline = await store.getPipelineRun(gateRecord.pipelineRunId);
			if (!pipeline) {
				console.error(
					chalk.red(`Pipeline run "${gateRecord.pipelineRunId}" not found`),
				);
				process.exit(1);
			}

			try {
				await controller.reviseGate(id, opts.notes, opts.reviewer);
				console.log(chalk.yellow("Revision requested. Re-running agents..."));
				console.log(chalk.dim(`Notes: ${opts.notes}`));

				let config: ReturnType<typeof loadConfig>;
				try {
					config = loadConfig();
				} catch {
					console.log(
						chalk.dim(
							"No API key configured — agents scheduled but not executed.",
						),
					);
					return;
				}

				const outputBase = join(
					config.outputDir,
					pipeline.projectName,
					pipeline.sessionName || pipeline.id,
				);
				const revisedPipelineDef = loadPipelineDef(pipeline.pipelineName);
				const executor = createAgentExecutor("local", { config });
				const result = await executePipeline(
					pipeline.id,
					pipeline.projectName,
					store,
					controller,
					config,
					outputBase,
					revisedPipelineDef ?? undefined,
					undefined,
					executor,
				);

				if (result.pausedAtGate) {
					console.log(
						chalk.yellow(
							`Revision complete. Gate reopened (phase ${result.phaseCompleted} → ${result.phaseNext})`,
						),
					);
					console.log(
						chalk.dim(
							`  Use 'sdlc-agent gate approve ${result.gateId}' to continue`,
						),
					);
				}
			} catch (err) {
				console.error(
					chalk.red(err instanceof Error ? err.message : String(err)),
				);
				process.exit(1);
			}
		});
}

function loadPipelineDef(pipelineName: string) {
	// Runtime DefinitionStore (DB-backed in platform mode) wins over the
	// filesystem fallback so apply'd pipelines are visible to gate handlers.
	const runtime = getRuntimeDefinitionStore();
	if (runtime) {
		const def = runtime.getPipeline(pipelineName);
		if (def) return def;
		return null;
	}
	const pipelinePath = resolve(
		join(resolveAgentforgeDir(), "pipelines", `${pipelineName}.pipeline.yaml`),
	);
	if (!existsSync(pipelinePath)) return null;
	try {
		const content = readFileSync(pipelinePath, "utf-8");
		return parsePipelineDefinition(content);
	} catch {
		return null;
	}
}
