import type { AgentRunRecord, PhaseSummary } from "../api/types";
import { ElapsedTime } from "./ElapsedTime";
import { StatusBadge } from "./ui/StatusBadge";

function phaseStepClass(status: string) {
	if (status === "succeeded" || status === "completed") return "done";
	if (status === "waiting-gate" || status === "revision-requested")
		return "gate";
	if (status === "running" || status === "active") return "active";
	if (status === "failed") return "failed";
	if (status === "skipped") return "skipped";
	return "pending";
}

const stepIcons: Record<string, string> = {
	done: "\u2713",
	active: "\u25cf",
	gate: "\u23f8",
	failed: "\u2717",
	pending: "\u25cb",
	skipped: "\u2014",
};

const circleColors: Record<string, string> = {
	done: "border-good text-good bg-good/10",
	active: "border-warn text-warn bg-warn/10",
	gate: "border-purple text-purple bg-purple/10",
	failed: "border-bad text-bad bg-bad/10",
	pending: "border-border text-muted bg-transparent",
	skipped: "border-border text-muted/50 bg-transparent",
};

const lineColors: Record<string, string> = {
	done: "bg-good",
	active: "bg-warn/50",
	gate: "bg-purple/50",
	failed: "bg-bad/30",
	pending: "bg-border",
	skipped: "bg-border/50",
};

function InProgressBadge() {
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-warn bg-warn/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warn">
			<span className="relative flex h-2 w-2">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-75" />
				<span className="relative inline-flex h-2 w-2 rounded-full bg-warn" />
			</span>
			in progress
		</span>
	);
}

interface Props {
	phases: PhaseSummary[];
	runs: AgentRunRecord[];
	onAgentClick?: (runId: string) => void;
}

export function PhaseAgentMap({ phases, runs, onAgentClick }: Props) {
	// Use the pipeline's own phase list (ordered + named by definition).
	// Fall back to sparse data-derived phases only when no definition was supplied.
	const phaseNums = new Set<number>([
		...phases.map((p) => p.phase),
		...runs.map((r) => r.phase),
	]);
	const allPhases: PhaseSummary[] = phases.length
		? phases.map((p) => ({ ...p }))
		: [...phaseNums]
				.sort((a, b) => a - b)
				.map((phase) => ({ phase, status: "pending", runs: 0 }));

	const runsByPhase = new Map<number, AgentRunRecord[]>();
	for (const r of runs) {
		const list = runsByPhase.get(r.phase) ?? [];
		list.push(r);
		runsByPhase.set(r.phase, list);
	}

	return (
		<div className="overflow-x-auto">
			<div className="flex items-start gap-0">
				{allPhases.map((phase, i) => {
					const cls = phaseStepClass(phase.status);
					const phaseRuns = runsByPhase.get(phase.phase) ?? [];
					const isGate =
						phase.status === "waiting-gate" ||
						phase.status === "revision-requested";

					return (
						<div
							key={phase.phase}
							className="relative flex min-w-[150px] flex-1 flex-col items-center"
						>
							{i < allPhases.length - 1 && (
								<div
									className={`absolute left-1/2 top-4 h-0.5 w-full ${lineColors[cls]}`}
								/>
							)}

							<div
								className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${circleColors[cls]}`}
							>
								{stepIcons[cls]}
							</div>

							<span className="mt-1.5 text-center text-[11px] font-medium text-muted">
								{phase.name ?? `Phase ${phase.phase}`}
							</span>

							{isGate && (
								<span className="mt-1 flex items-center gap-1 animate-pulse-subtle rounded-full border border-purple bg-purple/20 px-2.5 py-1 text-[11px] font-bold text-purple">
									<span className="relative flex h-2 w-2">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple opacity-75" />
										<span className="relative inline-flex h-2 w-2 rounded-full bg-purple" />
									</span>
									{phase.status === "waiting-gate"
										? "ACTION NEEDED"
										: "REVISION REQUESTED"}
								</span>
							)}

							{phase.status === "skipped" && (
								<span className="mt-1 text-[10px] italic text-muted/50">
									skipped
								</span>
							)}

							<div className="mt-2 flex w-full flex-col items-center gap-1.5 px-1">
								{/* Active agent cards with runs */}
								{phaseRuns.map((r) => {
									const isActive =
										r.status === "running" ||
										r.status === "pending" ||
										r.status === "scheduled";
									const borderCls = isActive
										? "border-warn"
										: r.status === "succeeded"
											? "border-good/40"
											: r.status === "failed"
												? "border-bad/60"
												: "border-border";
									const bgCls = isActive
										? "bg-warn/10"
										: r.status === "failed"
											? "bg-bad/5"
											: "bg-panel";
									return (
										<button
											key={r.id}
											type="button"
											onClick={() => onAgentClick?.(r.id)}
											className={`w-full min-w-[130px] max-w-[160px] rounded-md border-2 px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05] ${borderCls} ${bgCls}`}
										>
											<div className="text-xs font-semibold">{r.agentName}</div>
											<div className="mt-0.5">
												{isActive ? (
													<InProgressBadge />
												) : (
													<StatusBadge status={r.status} />
												)}
											</div>
											<div className="mt-1 text-[10px] text-muted">
												{r.humanEquivalent ?? r.displayName ?? "Agent"}
											</div>
											<div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
												{r.costUsd != null && (
													<span>${r.costUsd.toFixed(2)}</span>
												)}
												{r.durationMs != null && (
													<span>{(r.durationMs / 1000).toFixed(1)}s</span>
												)}
												{isActive && r.startedAt && (
													<span className="font-medium text-warn">
														<ElapsedTime startedAt={r.startedAt} />
													</span>
												)}
											</div>
										</button>
									);
								})}

								{/* Future agent placeholders — readable contrast */}
								{phaseRuns.length === 0 &&
									phase.expectedAgents &&
									phase.expectedAgents.length > 0 &&
									phase.expectedAgents.map((agent) => (
										<div
											key={agent}
											className="w-full min-w-[130px] max-w-[160px] rounded-md border border-border bg-panel px-2.5 py-2"
										>
											<div className="text-xs font-semibold text-text">
												{agent}
											</div>
											<div className="mt-1 text-[10px] text-text/60">
												Agent
											</div>
											<div className="mt-0.5 text-[10px] text-muted">
												{phase.status === "skipped" ? "skipped" : "not started"}
											</div>
										</div>
									))}
								{phaseRuns.length === 0 &&
									(!phase.expectedAgents ||
										phase.expectedAgents.length === 0) && (
										<div className="w-full max-w-[130px] rounded-md border border-dashed border-border px-2 py-2 text-center text-[10px] text-muted">
											{phase.status === "skipped" ? "skipped" : "pending"}
										</div>
									)}
							</div>
						</div>
					);
				})}
			</div>

		</div>
	);
}
