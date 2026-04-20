import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Command } from "commander";
import type { GateController } from "../../control-plane/gate-controller.js";
import type { PipelineController } from "../../control-plane/pipeline-controller.js";
import { createDashboardServer } from "../../dashboard/server.js";
import type { DefinitionStore } from "../../definitions/store.js";
import type { AppConfig } from "../../di/config.js";
import type { IAgentExecutor } from "../../domain/ports/agent-executor.port.js";
import type { IEventBus } from "../../domain/ports/event-bus.port.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";
import { executePipeline } from "../pipeline-executor.js";

export interface DashboardCommandDeps {
	readonly store: IStateStore;
	readonly gateController: GateController;
	readonly pipelineController?: PipelineController;
	readonly definitionStore?: DefinitionStore;
	readonly config?: AppConfig;
	readonly eventBus?: IEventBus;
	/**
	 * Agent executor injected so dashboard-initiated pipeline runs go through
	 * the P18 IAgentExecutor path (live conversation streaming, real cancel).
	 */
	readonly agentExecutor?: IAgentExecutor;
}

export function registerDashboardCommand(
	program: Command,
	deps: DashboardCommandDeps,
): void {
	const {
		store,
		gateController,
		pipelineController,
		definitionStore,
		config,
		eventBus,
		agentExecutor,
	} = deps;
	program
		.command("dashboard")
		.description("Start the live control-plane dashboard and resource API")
		.option("--host <host>", "Host to bind", "127.0.0.1")
		.option("-p, --port <port>", "Port to bind", "3001")
		.action(
			(opts: { host?: string; port?: string }) =>
				new Promise<void>((resolve) => {
					const host = opts.host ?? "127.0.0.1";
					const port = Number(opts.port ?? "3001");
					const server = createDashboardServer({
						store,
						eventBus,
						gateController,
						pipelineController,
						definitionStore,
						outputDir: config?.outputDir,
						executePipeline: (() => {
							if (!config || !pipelineController || !agentExecutor) {
								return undefined;
							}
							// Narrow captures once so the inner closure doesn't need
							// re-checks — all three are guaranteed non-null here.
							const cfg = config;
							const ctrl = pipelineController;
							const exec = agentExecutor;
							return async (runId, projectName, pipelineDef, inputs) => {
								const pipelineRun = await store.getPipelineRun(runId);
								const sessionFolder = pipelineRun?.sessionName || runId;
								const outputBase = join(
									cfg.outputDir,
									projectName,
									sessionFolder,
								);
								console.log(
									`[dashboard] Starting executor for pipeline ${runId} (${projectName})`,
								);
								void executePipeline(
									runId,
									projectName,
									store,
									ctrl,
									cfg,
									outputBase,
									pipelineDef,
									Object.keys(inputs).length > 0 ? inputs : undefined,
									exec,
								)
									.then(async (result) => {
										if (result.pausedAtGate) {
											console.log(
												`[dashboard] Pipeline ${runId} paused at gate (${result.gateId})`,
											);
										} else {
											const final = await store.getPipelineRun(runId);
											console.log(
												`[dashboard] Pipeline ${runId} finished: ${final?.status ?? "unknown"}`,
											);
										}
									})
									.catch((err) => {
										console.error(
											`[dashboard] Pipeline ${runId} executor error:`,
											err instanceof Error ? err.message : err,
										);
									});
							};
						})(),
					});

					server.listen(port, host, () => {
						const address = server.address() as AddressInfo;
						console.log(
							`Dashboard listening on http://${host}:${address.port}/`,
						);
						console.log(`API base: http://${host}:${address.port}/api/v1`);
						console.log("Press Ctrl+C to stop.");
					});

					// Ctrl+C: cancel only actively-running pipelines BEFORE closing the
					// server so their in-flight LLM calls are aborted. paused_at_gate
					// pipelines are intentionally left alone — they have no live work
					// to abort, and their gate state must survive a restart so the
					// user can still approve/reject after bringing the dashboard back.
					let shuttingDown = false;
					const shutdown = async () => {
						if (shuttingDown) return;
						shuttingDown = true;
						console.log(
							"\n[dashboard] shutting down — cancelling running pipelines…",
						);
						if (pipelineController) {
							try {
								const pipelines = await store.listPipelineRuns();
								const running = pipelines.filter((p) => p.status === "running");
								for (const p of running) {
									try {
										await pipelineController.stopPipeline(p.id);
										console.log(`[dashboard]   cancelled ${p.id}`);
									} catch (err) {
										console.error(
											`[dashboard]   failed to cancel ${p.id}:`,
											err instanceof Error ? err.message : err,
										);
									}
								}
							} catch (err) {
								console.error(
									"[dashboard] failed to list pipelines during shutdown:",
									err instanceof Error ? err.message : err,
								);
							}
						}
						server.close(() => resolve());
					};
					process.once("SIGINT", () => void shutdown());
					process.once("SIGTERM", () => void shutdown());
				}),
		);
}
