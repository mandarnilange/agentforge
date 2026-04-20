import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DefinitionStore } from "../../definitions/store.js";
import type { AgentRunRecord } from "../../domain/models/agent-run.model.js";
import type { Gate } from "../../domain/models/gate.model.js";
import type { NodeRecord } from "../../domain/models/node.model.js";
import type { PipelineRun } from "../../domain/models/pipeline-run.model.js";
import type { ConversationEntry } from "../../domain/ports/execution-backend.port.js";
import type {
	AuditLog,
	IStateStore,
} from "../../domain/ports/state-store.port.js";

export interface ArtifactResource {
	path: string;
	preview: string;
}

export interface PhaseSummaryResource {
	phase: number;
	/** Phase name from pipeline definition; omitted when no definition is available. */
	name?: string;
	status: string;
	runs: number;
	expectedAgents: string[];
}

export interface PipelineDetailResource {
	run: PipelineRun;
	runs: AgentRunRecord[];
	gates: Gate[];
	phaseSummary: PhaseSummaryResource[];
}

export interface CostSummaryResource {
	totalCostUsd: number;
	byPipeline: Array<{ id: string; name: string; cost: number }>;
	byAgent: Array<{ name: string; cost: number }>;
	byModel: Array<{ provider: string; model: string; cost: number }>;
}

export interface DashboardSummaryResource {
	pipelineCount: number;
	runningPipelines: number;
	pausedPipelines: number;
	nodeCount: number;
	onlineNodes: number;
	pendingGates: number;
	runCount: number;
	totalCostUsd: number;
}

export interface DashboardResourceServiceOptions {
	/**
	 * Config outputDir for resolving live conversation sidecars before any
	 * artifact has been written. Used to compute the convention path
	 * `{outputDir}/{projectName}/{sessionName||runId}/phase-{phase}/
	 * {agentName}-conversation.jsonl` so the dashboard can stream messages
	 * during an in-flight run.
	 */
	outputDir?: string;
}

export class DashboardResourceService {
	private readonly outputDir?: string;

	constructor(
		private readonly store: IStateStore,
		private readonly definitionStore?: DefinitionStore,
		options?: DashboardResourceServiceOptions,
	) {
		this.outputDir = options?.outputDir;
	}

	async getSummary(): Promise<DashboardSummaryResource> {
		const pipelines = await this.store.listPipelineRuns();
		const nodes = await this.store.listNodes();
		const runsArrays = await Promise.all(
			pipelines.map((pipeline) => this.store.listAgentRuns(pipeline.id)),
		);
		const runs = runsArrays.flat();
		const gatesArrays = await Promise.all(
			pipelines.map((pipeline) => this.store.listGates(pipeline.id)),
		);
		const gates = gatesArrays.flat();
		return {
			pipelineCount: pipelines.length,
			runningPipelines: pipelines.filter((p) => p.status === "running").length,
			pausedPipelines: pipelines.filter((p) => p.status === "paused_at_gate")
				.length,
			nodeCount: nodes.length,
			onlineNodes: nodes.filter((n) => n.status === "online").length,
			pendingGates: gates.filter((g) => g.status === "pending").length,
			runCount: runs.length,
			totalCostUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		};
	}

	async listPipelines(): Promise<PipelineRun[]> {
		return this.store.listPipelineRuns();
	}

	async getPipeline(id: string): Promise<PipelineDetailResource | null> {
		const pipeline = await this.store.getPipelineRun(id);
		if (!pipeline) return null;
		const runs = await this.store.listAgentRuns(id);
		const gates = await this.store.listGates(id);

		// Enrich running/pending agents with last activity timestamp and budget info
		const enrichedRuns = runs.map((r) => {
			const withActivity =
				r.status === "running" ||
				r.status === "pending" ||
				r.status === "scheduled"
					? { ...r, lastActivityAt: this.getConversationLogMtime(r, pipeline) }
					: r;

			// Attach metadata + budget from definition store so the dashboard can render labels and usage
			if (!this.definitionStore) return withActivity;
			const def = this.definitionStore.getAgent(r.agentName);
			if (!def) return withActivity;
			const enriched: AgentRunRecord = {
				...withActivity,
				displayName: def.metadata.displayName,
				humanEquivalent: def.metadata.humanEquivalent,
			};
			const budget = def.spec.resources?.budget;
			if (!budget) return enriched;
			return {
				...enriched,
				budgetTokens: budget.maxTotalTokens,
				budgetCostUsd: budget.maxCostUsd,
			};
		});

		return {
			run: pipeline,
			runs: enrichedRuns,
			gates,
			phaseSummary: this.summarizePhases(pipeline, enrichedRuns, gates),
		};
	}

	async listRuns(pipelineId: string): Promise<AgentRunRecord[]> {
		return this.store.listAgentRuns(pipelineId);
	}

	async getRun(id: string): Promise<AgentRunRecord | null> {
		return this.store.getAgentRun(id);
	}

	async getRunArtifacts(id: string): Promise<ArtifactResource[] | null> {
		const run = await this.store.getAgentRun(id);
		if (!run) return null;
		return run.outputArtifactIds.map((path) => this.readArtifact(path));
	}

	async getRunConversation(id: string): Promise<ConversationEntry[] | null> {
		const run = await this.store.getAgentRun(id);
		if (!run) return null;
		const pipeline = await this.store.getPipelineRun(run.pipelineRunId);
		return this.loadConversation(run, pipeline ?? undefined);
	}

	async getRunLogs(id: string): Promise<{
		run: AgentRunRecord;
		conversation: ConversationEntry[];
		artifacts: ArtifactResource[];
	} | null> {
		const run = await this.store.getAgentRun(id);
		if (!run) return null;
		const pipeline = await this.store.getPipelineRun(run.pipelineRunId);
		return {
			run,
			conversation: this.loadConversation(run, pipeline ?? undefined),
			artifacts: run.outputArtifactIds.map((path) => this.readArtifact(path)),
		};
	}

	async listNodes(): Promise<NodeRecord[]> {
		return this.store.listNodes();
	}

	async getNode(name: string): Promise<NodeRecord | null> {
		return this.store.getNode(name);
	}

	async listGates(pipelineId: string): Promise<Gate[]> {
		return this.store.listGates(pipelineId);
	}

	async listPendingGates(): Promise<
		Array<
			Gate & {
				projectName: string;
				pipelineName: string;
				phaseCompletedName?: string;
				phaseNextName?: string;
			}
		>
	> {
		const pipelines = await this.store.listPipelineRuns();
		const pending: Array<
			Gate & {
				projectName: string;
				pipelineName: string;
				phaseCompletedName?: string;
				phaseNextName?: string;
			}
		> = [];
		const phaseNameCache = new Map<string, Map<number, string>>();
		const phaseNamesFor = (
			pipelineName: string,
		): Map<number, string> | undefined => {
			let cached = phaseNameCache.get(pipelineName);
			if (cached) return cached;
			const def = this.definitionStore?.getPipeline(pipelineName);
			if (!def) return undefined;
			cached = new Map<number, string>();
			for (const phase of def.spec.phases) {
				cached.set(phase.phase, phase.name);
			}
			phaseNameCache.set(pipelineName, cached);
			return cached;
		};
		for (const p of pipelines) {
			const gates = await this.store.listGates(p.id);
			const names = phaseNamesFor(p.pipelineName);
			for (const g of gates) {
				if (g.status === "pending") {
					pending.push({
						...g,
						projectName: p.projectName,
						pipelineName: p.pipelineName,
						phaseCompletedName: names?.get(g.phaseCompleted),
						phaseNextName: names?.get(g.phaseNext),
					});
				}
			}
		}
		return pending;
	}

	async getGate(id: string): Promise<Gate | null> {
		return this.store.getGate(id);
	}

	async getCostSummary(): Promise<CostSummaryResource> {
		const pipelines = await this.store.listPipelineRuns();
		const pipelineCosts: Array<{ id: string; name: string; cost: number }> = [];
		const agentMap = new Map<string, number>();
		const modelMap = new Map<
			string,
			{ provider: string; model: string; cost: number }
		>();
		let totalCostUsd = 0;

		for (const pipeline of pipelines) {
			const runs = await this.store.listAgentRuns(pipeline.id);
			let pipelineCost = 0;
			for (const run of runs) {
				const cost = run.costUsd ?? 0;
				pipelineCost += cost;
				totalCostUsd += cost;
				agentMap.set(run.agentName, (agentMap.get(run.agentName) ?? 0) + cost);
				if (run.provider && run.modelName) {
					const key = `${run.provider}:${run.modelName}`;
					const existing = modelMap.get(key);
					if (existing) {
						existing.cost += cost;
					} else {
						modelMap.set(key, {
							provider: run.provider,
							model: run.modelName,
							cost,
						});
					}
				}
			}
			pipelineCosts.push({
				id: pipeline.id,
				name: pipeline.projectName,
				cost: pipelineCost,
			});
		}

		return {
			totalCostUsd,
			byPipeline: pipelineCosts.sort((a, b) => b.cost - a.cost),
			byAgent: [...agentMap.entries()]
				.map(([name, cost]) => ({ name, cost }))
				.sort((a, b) => b.cost - a.cost),
			byModel: [...modelMap.values()].sort((a, b) => b.cost - a.cost),
		};
	}

	async getAuditLog(pipelineRunId?: string): Promise<AuditLog[]> {
		return this.store.listAuditLog(pipelineRunId);
	}

	async listArtifacts(pipelineId?: string): Promise<ArtifactResource[]> {
		let runs: AgentRunRecord[];
		if (pipelineId) {
			runs = await this.store.listAgentRuns(pipelineId);
		} else {
			const pipelines = await this.store.listPipelineRuns();
			const runsArrays = await Promise.all(
				pipelines.map((pipeline) => this.store.listAgentRuns(pipeline.id)),
			);
			runs = runsArrays.flat();
		}
		const unique = [...new Set(runs.flatMap((run) => run.outputArtifactIds))];
		return unique.map((path) => this.readArtifact(path));
	}

	getArtifactContent(path: string): { path: string; content: unknown } | null {
		if (!existsSync(path)) return null;
		try {
			const raw = readFileSync(path, "utf-8");
			try {
				return { path, content: JSON.parse(raw) };
			} catch {
				return { path, content: raw };
			}
		} catch {
			return null;
		}
	}

	private summarizePhases(
		pipeline: PipelineRun,
		runs: AgentRunRecord[],
		gates: Gate[],
	): PhaseSummaryResource[] {
		const pipelineDef = this.definitionStore?.getPipeline(
			pipeline.pipelineName,
		);

		// Build the ordered list of (phase, name?) tuples to summarise.
		// Prefer the pipeline definition — those are the phases the user actually declared.
		// Fallback: union of phase numbers found in runs + gates, so older pipeline runs
		// without a live definition still render something meaningful.
		const phaseNameByNumber = new Map<number, string>();
		const agentsByPhase = new Map<number, string[]>();
		let orderedPhases: number[];

		if (pipelineDef) {
			orderedPhases = [];
			for (const p of pipelineDef.spec.phases) {
				phaseNameByNumber.set(p.phase, p.name);
				agentsByPhase.set(p.phase, p.agents);
				if (!orderedPhases.includes(p.phase)) orderedPhases.push(p.phase);
			}
		} else {
			const fromData = new Set<number>();
			for (const r of runs) fromData.add(r.phase);
			for (const g of gates) {
				fromData.add(g.phaseCompleted);
				fromData.add(g.phaseNext);
			}
			orderedPhases = [...fromData].sort((a, b) => a - b);
		}

		return orderedPhases.map((phase) => {
			const phaseRuns = runs.filter((r) => r.phase === phase);
			const gate = gates.find((g) => g.phaseCompleted === phase);
			const expectedAgents = agentsByPhase.get(phase) ?? [];
			const name = phaseNameByNumber.get(phase);

			if (phaseRuns.length === 0) {
				if (pipeline.status === "failed" && phase > pipeline.currentPhase) {
					return { phase, name, status: "skipped", runs: 0, expectedAgents };
				}
				return { phase, name, status: "pending", runs: 0, expectedAgents };
			}

			let status = "scheduled";
			if (phaseRuns.some((r) => r.status === "failed")) status = "failed";
			else if (gate?.status === "pending") status = "waiting-gate";
			else if (gate?.status === "revision_requested")
				status = "revision-requested";
			else if (
				phaseRuns.every((r) => r.status === "succeeded") &&
				(pipeline.currentPhase > phase || pipeline.status === "completed")
			)
				status = "completed";
			else if (
				phaseRuns.some((r) => r.status === "pending" || r.status === "running")
			)
				status = "active";
			return {
				phase,
				name,
				status,
				runs: phaseRuns.length,
				expectedAgents,
			};
		});
	}

	/**
	 * Resolve the JSONL sidecar path for an agent run. Tries two strategies:
	 * 1. If the run already has output artifacts, use dirname(firstArtifact) —
	 *    works after the run has produced any output.
	 * 2. Otherwise use the convention path
	 *    `{outputDir}/{projectName}/{sessionName||runId}/phase-{phase}/
	 *    {agentName}-conversation.jsonl` — works during a live run where the
	 *    first artifact hasn't been saved yet. Requires outputDir in options.
	 */
	private resolveConversationLogPath(
		run: AgentRunRecord,
		pipeline?: PipelineRun,
	): string | undefined {
		const firstArtifact = run.outputArtifactIds[0];
		if (firstArtifact) {
			return join(
				dirname(firstArtifact),
				`${run.agentName}-conversation.jsonl`,
			);
		}
		if (this.outputDir && pipeline) {
			const sessionFolder = pipeline.sessionName || pipeline.id;
			return join(
				this.outputDir,
				pipeline.projectName,
				sessionFolder,
				`phase-${run.phase}`,
				`${run.agentName}-conversation.jsonl`,
			);
		}
		return undefined;
	}

	private getConversationLogMtime(
		run: AgentRunRecord,
		pipeline?: PipelineRun,
	): string | undefined {
		const logPath = this.resolveConversationLogPath(run, pipeline);
		if (!logPath || !existsSync(logPath)) return undefined;
		try {
			return statSync(logPath).mtime.toISOString();
		} catch {
			return undefined;
		}
	}

	private loadConversation(
		run: AgentRunRecord,
		pipeline?: PipelineRun,
	): ConversationEntry[] {
		const logPath = this.resolveConversationLogPath(run, pipeline);
		if (!logPath || !existsSync(logPath)) return [];
		try {
			return readFileSync(logPath, "utf-8")
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as ConversationEntry);
		} catch {
			return [];
		}
	}

	private readArtifact(path: string): ArtifactResource {
		if (!existsSync(path)) return { path, preview: "(file not found)" };
		try {
			const raw = readFileSync(path, "utf-8");
			try {
				return {
					path,
					preview: JSON.stringify(JSON.parse(raw), null, 2).slice(0, 4000),
				};
			} catch {
				return { path, preview: raw.slice(0, 4000) };
			}
		} catch {
			return { path, preview: "(could not read file)" };
		}
	}
}
