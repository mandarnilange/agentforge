import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { usePipeline } from "../api/hooks";
import type { AgentRunRecord, Gate, PhaseSummary } from "../api/types";
import { AuditTimeline } from "../components/AuditTimeline";
import { ElapsedTime } from "../components/ElapsedTime";
import { PhaseAgentMap } from "../components/PhaseAgentMap";
import { RunCard } from "../components/RunCard";
import { StatusBadge } from "../components/ui/StatusBadge";

function phaseName(
	phase: number,
	phases: PhaseSummary[] | undefined,
): string {
	return (
		phases?.find((p) => p.phase === phase)?.name ?? `Phase ${phase}`
	);
}

function LiveStatusBanner({
	isRunning,
	isPaused,
	isCompleted,
	isFailed,
	activeRuns,
	currentPhase,
	pipelineStartedAt,
	phases,
}: {
	isRunning: boolean;
	isPaused: boolean;
	pipelineStartedAt: string;
	isCompleted: boolean;
	isFailed: boolean;
	activeRuns: AgentRunRecord[];
	currentPhase: number;
	phases: PhaseSummary[];
}) {
	if (isCompleted) {
		return (
			<div className="rounded-lg border border-good/40 bg-good/10 px-4 py-3">
				<div className="flex items-center gap-2 text-sm font-semibold text-good">
					<span className="text-lg">&#10003;</span>
					Pipeline completed successfully
				</div>
			</div>
		);
	}

	if (isFailed) {
		return (
			<div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3">
				<div className="flex items-center gap-2 text-sm font-semibold text-bad">
					<span className="text-lg">&#10007;</span>
					Pipeline failed — check agent errors below
				</div>
			</div>
		);
	}

	if (isPaused) {
		return null; // GateActionBanner handles this
	}

	if (isRunning && activeRuns.length > 0) {
		const firstRun = activeRuns[0] as AgentRunRecord;
		const now = Date.now();
		const hasActivity = activeRuns.some((r) => r.lastActivityAt);
		const latestActivity = activeRuns.reduce((latest, r) => {
			if (!r.lastActivityAt) return latest;
			const t = new Date(r.lastActivityAt).getTime();
			return t > latest ? t : latest;
		}, 0);
		const secondsAgo = latestActivity
			? Math.floor((now - latestActivity) / 1000)
			: null;

		// Elapsed since agent started
		const elapsedMs = now - new Date(firstRun.startedAt).getTime();
		const elapsedMin = Math.floor(elapsedMs / 60_000);

		// Stale = log activity stopped >60s ago, OR no log at all and running >5min
		const isStale =
			(hasActivity && secondsAgo !== null && secondsAgo > 60) ||
			(!hasActivity && elapsedMin >= 5);

		let activityLabel: string;
		let activityClass: string;
		if (hasActivity && secondsAgo !== null) {
			if (secondsAgo <= 10) {
				activityLabel = `Active now (${secondsAgo}s ago)`;
				activityClass = "text-good";
			} else if (secondsAgo <= 60) {
				activityLabel = `Last output ${secondsAgo}s ago`;
				activityClass = "text-good";
			} else {
				activityLabel = `No output for ${Math.floor(secondsAgo / 60)}m ${secondsAgo % 60}s — may be stuck`;
				activityClass = "font-medium text-bad";
			}
		} else if (elapsedMin >= 5) {
			activityLabel = `No log output after ${elapsedMin}m — likely stuck or process died`;
			activityClass = "font-medium text-bad";
		} else {
			activityLabel = "Waiting for first output...";
			activityClass = "text-muted";
		}

		return (
			<div
				className={`rounded-lg border px-4 py-3 ${isStale ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/10"}`}
			>
				<div className="flex items-center gap-3">
					<span className="relative flex h-3 w-3">
						<span
							className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${isStale ? "bg-bad" : "bg-warn"}`}
						/>
						<span
							className={`relative inline-flex h-3 w-3 rounded-full ${isStale ? "bg-bad" : "bg-warn"}`}
						/>
					</span>
					<div className="flex-1">
						<div
							className={`text-sm font-semibold ${isStale ? "text-bad" : "text-warn"}`}
						>
							{isStale ? "Possibly stuck: " : "Running: "}
							{activeRuns
								.map(
									(r) =>
										`${r.agentName} (${r.humanEquivalent ?? r.displayName ?? "Agent"})`,
								)
								.join(", ")}
						</div>
						<div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-text/70">
							<span>
								Phase {currentPhase} &middot; {phaseName(currentPhase, phases)}
							</span>
							<span>
								Elapsed: <ElapsedTime startedAt={firstRun.startedAt} />
							</span>
							<span className={activityClass}>{activityLabel}</span>
						</div>
						{isStale && (
							<div className="mt-1.5 text-xs text-bad/80">
								Check the terminal running the pipeline CLI. If the process
								died, use: sdlc-agent run --continue {`<run-id>`}
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	if (isRunning && activeRuns.length === 0) {
		const elapsedMs = Date.now() - new Date(pipelineStartedAt).getTime();
		const elapsedMin = Math.floor(elapsedMs / 60_000);
		const isStuckScheduling = elapsedMin >= 2;

		return (
			<div
				className={`rounded-lg border px-4 py-3 ${isStuckScheduling ? "border-bad/40 bg-bad/10" : "border-warn/40 bg-warn/5"}`}
			>
				<div className="flex items-center gap-3">
					<span className="relative flex h-3 w-3">
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-75" />
						<span className="relative inline-flex h-3 w-3 rounded-full bg-warn" />
					</span>
					<div className="flex-1">
						<div
							className={`text-sm font-semibold ${isStuckScheduling ? "text-bad" : "text-warn"}`}
						>
							{isStuckScheduling
								? "Stuck — no agents scheduled"
								: "Scheduling agents"}{" "}
							for Phase {currentPhase} ({phaseName(currentPhase, phases)})
						</div>
						{isStuckScheduling && (
							<div className="mt-1 text-xs text-bad/80">
								The pipeline process may have crashed. Restart with: sdlc-agent
								run --continue {`<run-id>`}
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	return null;
}

function GateActionBanner({
	gate,
	phases,
}: {
	gate: Gate;
	phases: PhaseSummary[];
}) {
	const queryClient = useQueryClient();
	const [acting, setActing] = useState(false);
	const [showRevise, setShowRevise] = useState(false);
	const [notes, setNotes] = useState("");
	const [reviewer, setReviewer] = useState("");

	const doAction = async (action: "approve" | "reject" | "revise") => {
		setActing(true);
		try {
			const body: Record<string, string> = {};
			if (reviewer) body.reviewer = reviewer;
			if (action === "revise") body.notes = notes;
			await api.gateAction(gate.id, action, body);
			await queryClient.invalidateQueries({ queryKey: ["pipeline"] });
			await queryClient.invalidateQueries({ queryKey: ["summary"] });
		} finally {
			setActing(false);
		}
	};

	return (
		<div className="animate-pulse-subtle rounded-lg border-2 border-purple bg-purple/10 p-4">
			<div className="flex items-center gap-3">
				<span className="text-2xl">&#9208;</span>
				<div className="flex-1">
					<div className="text-sm font-semibold text-purple">
						Pipeline Paused — Awaiting Gate Approval
					</div>
					<div className="mt-0.5 text-xs text-text/70">
						{phaseName(gate.phaseCompleted, phases)} completed. Review artifacts
						and approve to continue to {phaseName(gate.phaseNext, phases)}.
					</div>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<input
					type="text"
					placeholder="Your name (optional)"
					value={reviewer}
					onChange={(e) => setReviewer(e.target.value)}
					className="rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-link"
				/>
				<button
					type="button"
					onClick={() => doAction("approve")}
					disabled={acting}
					className="rounded bg-good px-4 py-1.5 text-sm font-semibold text-white hover:bg-good/80 disabled:opacity-50"
				>
					Approve &amp; Continue
				</button>
				<button
					type="button"
					onClick={() => doAction("reject")}
					disabled={acting}
					className="rounded bg-bad/80 px-4 py-1.5 text-sm font-semibold text-white hover:bg-bad/60 disabled:opacity-50"
				>
					Reject
				</button>
				<button
					type="button"
					onClick={() => setShowRevise(!showRevise)}
					disabled={acting}
					className="rounded border border-warn px-4 py-1.5 text-sm font-semibold text-warn hover:bg-warn/10 disabled:opacity-50"
				>
					Request Revision
				</button>
			</div>

			{showRevise && (
				<div className="mt-2 flex gap-2">
					<textarea
						placeholder="Describe what needs to change..."
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						rows={2}
						className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-link"
					/>
					<button
						type="button"
						onClick={() => doAction("revise")}
						disabled={acting || !notes.trim()}
						className="self-end rounded bg-warn px-3 py-1.5 text-sm font-semibold text-white hover:bg-warn/80 disabled:opacity-50"
					>
						Submit
					</button>
				</div>
			)}
		</div>
	);
}

export function PipelineDetail() {
	const { id } = useParams<{ id: string }>();
	const { data, isLoading, error } = usePipeline(id ?? "");

	const queryClient = useQueryClient();
	const [operating, setOperating] = useState(false);

	const scrollToRun = useCallback((runId: string) => {
		document
			.getElementById(`run-${runId}`)
			?.scrollIntoView({ behavior: "smooth", block: "center" });
	}, []);

	if (isLoading) {
		return <div className="py-12 text-center text-muted">Loading...</div>;
	}

	if (error || !data) {
		return (
			<div className="py-12 text-center">
				<p className="text-bad">{error?.message ?? "Pipeline not found"}</p>
				<Link to="/" className="mt-4 text-sm text-link hover:underline">
					Back to Overview
				</Link>
			</div>
		);
	}

	const { run, runs, gates, phaseSummary } = data;

	// Group runs by phase
	const runsByPhase = new Map<number, typeof runs>();
	for (const r of runs) {
		const list = runsByPhase.get(r.phase) ?? [];
		list.push(r);
		runsByPhase.set(r.phase, list);
	}
	const sortedPhases = [...runsByPhase.keys()].sort((a, b) => a - b);

	const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
	const pendingGate = gates.find((g) => g.status === "pending");

	// Determine what's happening right now
	const activeRuns = runs.filter(
		(r) =>
			r.status === "running" ||
			r.status === "pending" ||
			r.status === "scheduled",
	);
	const isRunning = run.status === "running";
	const isPaused = run.status === "paused_at_gate";
	const isCompleted = run.status === "completed";
	const isFailed = run.status === "failed";
	const isCancelled = run.status === "cancelled";

	const handleStop = async () => {
		if (!id) return;
		setOperating(true);
		try {
			await api.stopPipeline(id);
			queryClient.invalidateQueries({ queryKey: ["pipeline", id] });
		} finally {
			setOperating(false);
		}
	};

	const handleRetry = async () => {
		if (!id) return;
		setOperating(true);
		try {
			await api.retryPipeline(id);
			queryClient.invalidateQueries({ queryKey: ["pipeline", id] });
		} finally {
			setOperating(false);
		}
	};

	return (
		<div className="space-y-6">
			<Link to="/" className="text-sm text-link hover:underline">
				&larr; Back to Overview
			</Link>

			{/* Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="text-xl font-semibold">{run.projectName}</h1>
					<p className="mt-1 text-sm text-muted">
						{run.pipelineName} &middot; Phase {run.currentPhase}
						{totalCost > 0 && ` \u00b7 $${totalCost.toFixed(4)}`}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<StatusBadge status={run.status} />
					{(isRunning || isPaused) && (
						<button
							type="button"
							onClick={handleStop}
							disabled={operating}
							className="rounded bg-bad px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
						>
							{operating ? "Stopping..." : "Stop"}
						</button>
					)}
					{(isFailed || isCancelled) && (
						<button
							type="button"
							onClick={handleRetry}
							disabled={operating}
							className="rounded bg-good px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
						>
							{operating ? "Retrying..." : "Retry"}
						</button>
					)}
				</div>
			</div>

			{/* Live Status Banner — always tells user exactly what's happening */}
			<LiveStatusBanner
				isRunning={isRunning}
				isPaused={isPaused}
				isCompleted={isCompleted}
				isFailed={isFailed}
				activeRuns={activeRuns}
				currentPhase={run.currentPhase}
				pipelineStartedAt={run.startedAt}
				phases={phaseSummary}
			/>

			{/* Gate Action Banner — prominent CTA when waiting */}
			{pendingGate && (
				<GateActionBanner gate={pendingGate} phases={phaseSummary} />
			)}

			{/* Phase & Agent Map */}
			<div className="rounded-lg border border-border bg-panel p-4">
				<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
					Phase &amp; Agent Map
				</h2>
				<PhaseAgentMap
					phases={phaseSummary}
					runs={runs}
					onAgentClick={scrollToRun}
				/>
			</div>

			{/* Gates history */}
			{gates.length > 0 && (
				<div className="rounded-lg border border-border bg-panel p-4">
					<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
						Gates
					</h2>
					{gates.map((g) => (
						<div
							key={g.id}
							className={`flex flex-wrap items-center gap-3 border-b border-border py-2 last:border-b-0 ${g.status === "pending" ? "bg-purple/5 -mx-4 px-4 rounded" : ""}`}
						>
							<span className="font-mono text-xs text-muted">
								{phaseName(g.phaseCompleted, phaseSummary)} &rarr;{" "}
								{phaseName(g.phaseNext, phaseSummary)}
							</span>
							<StatusBadge status={g.status} />
							{g.reviewer && (
								<span className="text-xs text-muted">{g.reviewer}</span>
							)}
							{g.comment && (
								<span className="text-xs italic text-muted">
									&ldquo;{g.comment}&rdquo;
								</span>
							)}
						</div>
					))}
				</div>
			)}

			{/* Agent Runs grouped by phase */}
			<div className="rounded-lg border border-border bg-panel p-4">
				<h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
					Agent Runs
				</h2>
				{runs.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted">No runs yet.</p>
				) : (
					<div className="space-y-4">
						{sortedPhases.map((phase) => (
							<div key={phase}>
								<h3 className="mb-2 text-xs font-medium text-muted">
									Phase {phase}
								</h3>
								<div className="space-y-2">
									{runsByPhase.get(phase)?.map((r) => (
										<div key={r.id} id={`run-${r.id}`}>
											<RunCard run={r} />
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Audit Trail */}
			<AuditTimeline pipelineId={id!} />
		</div>
	);
}
