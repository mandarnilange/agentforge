/**
 * PipelineController — orchestrates pipeline execution.
 * Creates pipeline runs, schedules agent runs, and handles phase transitions.
 * Delegates gate management to GateController.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRuntimeDefinitionStore } from "../agents/definition-source.js";
import {
	type AgentDefinitionYaml,
	type NodeDefinitionYaml,
	type PipelineDefinitionYaml,
	parseAgentDefinition,
	parseNodeDefinition,
	parsePipelineDefinition,
} from "../definitions/parser.js";
import { resolveAgentforgeDir } from "../di/agentforge-dir.js";
import type { AgentRunExitReason } from "../domain/models/agent-run.model.js";
import type { PipelineRun } from "../domain/models/pipeline-run.model.js";
import type { IAgentExecutor } from "../domain/ports/agent-executor.port.js";
import type { IRateLimiter } from "../domain/ports/rate-limiter.port.js";
import type { IStateStore } from "../domain/ports/state-store.port.js";
import type { GateController } from "./gate-controller.js";
import type { IAgentScheduler } from "./scheduler.js";

function parseDefinitionFileCompat(
	yamlContent: string,
): AgentDefinitionYaml | NodeDefinitionYaml | PipelineDefinitionYaml | null {
	if (yamlContent.includes("kind: AgentDefinition")) {
		return parseAgentDefinition(yamlContent);
	}
	if (yamlContent.includes("kind: NodeDefinition")) {
		return parseNodeDefinition(yamlContent);
	}
	if (yamlContent.includes("kind: PipelineDefinition")) {
		return parsePipelineDefinition(yamlContent);
	}
	return null;
}

export class PipelineController {
	private readonly activePipelineDefs = new Map<
		string,
		PipelineDefinitionYaml
	>();

	constructor(
		private readonly store: IStateStore,
		private readonly gateController: GateController,
		private readonly scheduler: IAgentScheduler,
		private readonly rateLimiter?: IRateLimiter,
		/**
		 * Optional so existing test fixtures that construct PipelineController
		 * without an executor still compile. When omitted, stopPipeline() only
		 * updates DB state (legacy behavior). Production callers should always
		 * inject an executor so Stop actually aborts in-flight runs.
		 */
		private readonly executor?: IAgentExecutor,
	) {}

	async startPipeline(
		projectName: string,
		pipelineDef: PipelineDefinitionYaml,
		inputs: Record<string, string>,
	): Promise<PipelineRun> {
		const run = await this.store.createPipelineRun({
			projectName: projectName.trim(),
			pipelineName: pipelineDef.metadata.name,
			status: "running",
			currentPhase: 1,
			inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
			startedAt: new Date().toISOString(),
		});

		this.activePipelineDefs.set(run.id, pipelineDef);
		await this.schedulePhase(run.id, 1, pipelineDef);
		return run;
	}

	async onAgentRunCompleted(
		agentRunId: string,
		outputArtifactIds: string[],
	): Promise<void> {
		const agentRun = await this.store.getAgentRun(agentRunId);
		if (!agentRun) throw new Error(`AgentRun "${agentRunId}" not found`);

		this.scheduler.recordRunCompleted(agentRun.nodeName);
		await this.store.updateAgentRun(agentRunId, {
			status: "succeeded",
			completedAt: new Date().toISOString(),
			outputArtifactIds,
		});

		const pipeline = await this.store.getPipelineRun(agentRun.pipelineRunId);
		if (
			!pipeline ||
			pipeline.status === "failed" ||
			pipeline.status === "cancelled"
		)
			return;

		// Check if all agents in this phase are done
		// Only consider the latest run per agent (handles retries creating duplicates)
		const allPhaseRuns = (
			await this.store.listAgentRuns(agentRun.pipelineRunId)
		).filter((r) => r.phase === agentRun.phase);
		const latestByAgent = new Map<string, (typeof allPhaseRuns)[0]>();
		for (const r of allPhaseRuns) {
			const existing = latestByAgent.get(r.agentName);
			if (
				!existing ||
				new Date(r.createdAt).getTime() > new Date(existing.createdAt).getTime()
			) {
				latestByAgent.set(r.agentName, r);
			}
		}
		const currentRuns = [...latestByAgent.values()];

		const anyFailed = currentRuns.some((r) => r.status === "failed");
		if (anyFailed) {
			await this.store.updatePipelineRun(agentRun.pipelineRunId, {
				status: "failed",
				completedAt: new Date().toISOString(),
			});
			return;
		}

		const allSucceeded = currentRuns.every(
			(r) => r.id === agentRunId || r.status === "succeeded",
		);

		if (!allSucceeded) return; // Still waiting for parallel agents

		// All done — open gate or complete pipeline
		const pipelineDef =
			this.activePipelineDefs.get(agentRun.pipelineRunId) ??
			this.loadPipelineDefFromDisk(pipeline.pipelineName);
		const currentPhaseDef = pipelineDef?.spec.phases.find(
			(p) => p.phase === agentRun.phase,
		);
		const nextPhaseDef = pipelineDef?.spec.phases.find(
			(p) => p.phase === agentRun.phase + 1,
		);

		if (currentPhaseDef?.gate?.required !== false) {
			// Gate required — open it. phaseNext = next phase number, or phase+1 if last (signals completion after approval)
			const phaseNext = nextPhaseDef ? nextPhaseDef.phase : agentRun.phase + 1;
			await this.gateController.openGate(
				agentRun.pipelineRunId,
				agentRun.phase,
				phaseNext,
				outputArtifactIds,
			);
		} else if (nextPhaseDef) {
			// No gate — advance directly
			await this.store.updatePipelineRun(agentRun.pipelineRunId, {
				currentPhase: nextPhaseDef.phase,
			});
			await this.schedulePhase(
				agentRun.pipelineRunId,
				nextPhaseDef.phase,
				pipelineDef as PipelineDefinitionYaml,
			);
		} else {
			// Last phase, no gate — complete
			await this.store.updatePipelineRun(agentRun.pipelineRunId, {
				status: "completed",
				completedAt: new Date().toISOString(),
			});
		}
	}

	async onAgentRunFailed(
		agentRunId: string,
		error: string,
		exitReason?: AgentRunExitReason,
	): Promise<void> {
		const agentRun = await this.store.getAgentRun(agentRunId);
		if (!agentRun) throw new Error(`AgentRun "${agentRunId}" not found`);

		this.scheduler.recordRunCompleted(agentRun.nodeName);
		await this.store.updateAgentRun(agentRunId, {
			status: "failed",
			error,
			exitReason,
			completedAt: new Date().toISOString(),
		});

		await this.store.updatePipelineRun(agentRun.pipelineRunId, {
			status: "failed",
		});
	}

	async approveGate(
		gateId: string,
		pipelineDef: PipelineDefinitionYaml,
		reviewer?: string,
		comment?: string,
	): Promise<void> {
		const approvedGate = await this.gateController.approve(
			gateId,
			reviewer,
			comment,
		);
		const nextPhaseDef = pipelineDef.spec.phases.find(
			(p) => p.phase === approvedGate.phaseNext,
		);

		if (!nextPhaseDef) {
			// No more phases — pipeline complete
			await this.store.updatePipelineRun(approvedGate.pipelineRunId, {
				status: "completed",
				completedAt: new Date().toISOString(),
			});
			return;
		}

		await this.store.updatePipelineRun(approvedGate.pipelineRunId, {
			status: "running",
			currentPhase: approvedGate.phaseNext,
		});
		await this.schedulePhase(
			approvedGate.pipelineRunId,
			approvedGate.phaseNext,
			pipelineDef,
		);
	}

	async rejectGate(
		gateId: string,
		reviewer?: string,
		comment?: string,
	): Promise<void> {
		await this.gateController.reject(gateId, reviewer, comment);
	}

	async reviseGate(
		gateId: string,
		notes: string,
		reviewer?: string,
	): Promise<void> {
		const revisedGate = await this.gateController.revise(
			gateId,
			notes,
			reviewer,
		);

		// Re-schedule agents for the completed phase so they re-run with revision notes
		const pipelineRun = await this.store.getPipelineRun(
			revisedGate.pipelineRunId,
		);
		const pipelineDef =
			this.activePipelineDefs.get(revisedGate.pipelineRunId) ??
			this.loadPipelineDefFromDisk(pipelineRun?.pipelineName ?? "");
		if (!pipelineDef) return;

		await this.store.updatePipelineRun(revisedGate.pipelineRunId, {
			status: "running",
			currentPhase: revisedGate.phaseCompleted,
		});
		await this.schedulePhase(
			revisedGate.pipelineRunId,
			revisedGate.phaseCompleted,
			pipelineDef,
			revisedGate.revisionNotes,
		);
	}

	async stopPipeline(pipelineRunId: string): Promise<PipelineRun> {
		const pipeline = await this.store.getPipelineRun(pipelineRunId);
		if (!pipeline) throw new Error(`Pipeline run "${pipelineRunId}" not found`);
		if (pipeline.status !== "running" && pipeline.status !== "paused_at_gate") {
			throw new Error(`Cannot stop pipeline in "${pipeline.status}" status`);
		}

		const agentRuns = await this.store.listAgentRuns(pipelineRunId);

		// 1) Cancel the in-flight work on the executor FIRST so the agent's LLM
		//    call is aborted and we minimize the window where executor.execute()
		//    completes and tries to save results for a cancelled run.
		if (this.executor) {
			for (const run of agentRuns) {
				if (run.status === "running" || run.status === "scheduled") {
					try {
						await this.executor.cancel(run.id);
					} catch {
						// Best-effort — never block cancellation on an executor failure
					}
				}
			}
		}

		// 2) Flip DB state for every pending/scheduled/running run so the race
		//    guard in pipeline-executor discards any late-arriving results.
		for (const run of agentRuns) {
			if (
				run.status === "pending" ||
				run.status === "scheduled" ||
				run.status === "running"
			) {
				this.scheduler.recordRunCompleted(run.nodeName);
				await this.store.updateAgentRun(run.id, {
					status: "failed",
					error: "Cancelled by user",
					completedAt: new Date().toISOString(),
				});
			}
		}

		await this.store.updatePipelineRun(pipelineRunId, {
			status: "cancelled",
			completedAt: new Date().toISOString(),
		});
		this.activePipelineDefs.delete(pipelineRunId);

		const updated = await this.store.getPipelineRun(pipelineRunId);
		return updated as PipelineRun;
	}

	async retryPipeline(
		pipelineRunId: string,
		pipelineDef: PipelineDefinitionYaml,
	): Promise<PipelineRun> {
		const pipeline = await this.store.getPipelineRun(pipelineRunId);
		if (!pipeline) throw new Error(`Pipeline run "${pipelineRunId}" not found`);
		if (pipeline.status !== "failed" && pipeline.status !== "cancelled") {
			throw new Error(`Cannot retry pipeline in "${pipeline.status}" status`);
		}

		await this.store.updatePipelineRun(pipelineRunId, {
			status: "running",
		});
		this.activePipelineDefs.set(pipelineRunId, pipelineDef);
		await this.schedulePhase(pipelineRunId, pipeline.currentPhase, pipelineDef);

		const updated = await this.store.getPipelineRun(pipelineRunId);
		return updated as PipelineRun;
	}

	async listPipelineRuns(): Promise<PipelineRun[]> {
		return this.store.listPipelineRuns();
	}

	async getPipelineRun(id: string): Promise<PipelineRun | null> {
		return this.store.getPipelineRun(id);
	}

	/** Public entry point for resuming a stuck pipeline at a given phase. */
	async schedulePhasePublic(
		pipelineRunId: string,
		phase: number,
		pipelineDef: PipelineDefinitionYaml,
		revisionNotes?: string,
	): Promise<void> {
		this.activePipelineDefs.set(pipelineRunId, pipelineDef);
		await this.schedulePhase(pipelineRunId, phase, pipelineDef, revisionNotes);
	}

	private async schedulePhase(
		pipelineRunId: string,
		phase: number,
		pipelineDef: PipelineDefinitionYaml,
		revisionNotes?: string,
	): Promise<void> {
		// Check rate limits before scheduling
		if (this.rateLimiter) {
			const violations = await this.rateLimiter.checkLimits(pipelineRunId);
			if (violations.length > 0) {
				const _messages = violations.map((v) => v.message).join("; ");
				await this.store.updatePipelineRun(pipelineRunId, {
					status: "failed",
					completedAt: new Date().toISOString(),
				});
				await this.store.writeAuditLog({
					pipelineRunId,
					actor: "rate-limiter",
					action: "limit_exceeded",
					resourceType: "pipeline_run",
					resourceId: pipelineRunId,
					metadata: { violations },
				});
				return;
			}
		}

		const phaseDef = pipelineDef.spec.phases.find((p) => p.phase === phase);
		if (!phaseDef) return;
		const nodePool = this.loadNodeDefsFromDisk();

		for (const agentName of phaseDef.agents) {
			const agentDef = this.loadAgentDefFromDisk(agentName);
			let selectedNode: (typeof nodePool)[0] | null = null;
			if (agentDef && nodePool.length > 0) {
				try {
					selectedNode = await this.scheduler.schedule(agentDef, nodePool);
				} catch {
					// No node satisfies requirements — fall back to local
				}
			}
			const nodeName = selectedNode?.metadata.name ?? "local";
			this.scheduler.recordRunStarted(nodeName);
			await this.store.createAgentRun({
				pipelineRunId,
				agentName,
				phase,
				nodeName,
				status: "pending",
				inputArtifactIds: [],
				outputArtifactIds: [],
				revisionNotes,
				startedAt: new Date().toISOString(),
			});
		}
	}

	private loadAgentDefFromDisk(agentName: string) {
		// Runtime DefinitionStore (DB-backed in platform mode) wins over the
		// filesystem fallback. Method name kept for git-blame continuity.
		const runtime = getRuntimeDefinitionStore();
		if (runtime) {
			const def = runtime.getAgent(agentName);
			return def ?? null;
		}
		try {
			const content = readFileSync(
				join(resolveAgentforgeDir(), "agents", `${agentName}.agent.yaml`),
				"utf-8",
			);
			const parsed = parseDefinitionFileCompat(content);
			return parsed?.kind === "AgentDefinition" ? parsed : null;
		} catch {
			return null;
		}
	}

	private loadNodeDefsFromDisk(): NodeDefinitionYaml[] {
		try {
			const raw = readFileSync(
				join(process.cwd(), "output", ".definitions.json"),
				"utf-8",
			);
			const parsed = JSON.parse(raw) as {
				nodes?: Array<Record<string, unknown>>;
			};
			return (parsed.nodes ?? [])
				.filter((n) => !!n && n.kind === "NodeDefinition")
				.map((n) => parseNodeDefinition(JSON.stringify(n)))
				.filter((n): n is NodeDefinitionYaml => n !== null);
		} catch {
			return [];
		}
	}

	private loadPipelineDefFromDisk(
		pipelineName: string,
	): PipelineDefinitionYaml | null {
		const runtime = getRuntimeDefinitionStore();
		if (runtime) {
			const def = runtime.getPipeline(pipelineName);
			return def ?? null;
		}
		try {
			const content = readFileSync(
				join(
					resolveAgentforgeDir(),
					"pipelines",
					`${pipelineName}.pipeline.yaml`,
				),
				"utf-8",
			);
			return parsePipelineDefinition(content);
		} catch {
			return null;
		}
	}
}
