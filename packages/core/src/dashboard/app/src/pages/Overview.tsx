import { useState } from "react";
import { useNavigate } from "react-router";
import { usePipelines, useSummary } from "../api/hooks";
import type { PipelineRun } from "../api/types";
import { MetricCard } from "../components/ui/MetricCard";
import { StatusBadge } from "../components/ui/StatusBadge";

const STATUS_FILTERS = [
	{ value: "all", label: "All" },
	{ value: "running", label: "Running" },
	{ value: "paused_at_gate", label: "Awaiting Gate" },
	{ value: "failed", label: "Failed" },
	{ value: "completed", label: "Completed" },
] as const;

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function Overview() {
	const navigate = useNavigate();
	const { data: summary } = useSummary();
	const { data: pipelines, isLoading } = usePipelines();
	const [filter, setFilter] = useState("all");

	const filtered =
		filter === "all"
			? pipelines
			: pipelines?.filter((p) => p.status === filter);

	const counts = (status: string) =>
		status === "all"
			? (pipelines?.length ?? 0)
			: (pipelines?.filter((p) => p.status === status).length ?? 0);

	return (
		<div className="space-y-6">
			{/* Summary cards */}
			{summary && (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
					<MetricCard label="Pipelines" value={summary.pipelineCount} />
					<MetricCard label="Running" value={summary.runningPipelines} />
					<MetricCard label="Paused at Gate" value={summary.pausedPipelines} />
					<MetricCard label="Pending Gates" value={summary.pendingGates} />
					<MetricCard
						label="Total Cost"
						value={`$${Number(summary.totalCostUsd || 0).toFixed(4)}`}
					/>
				</div>
			)}

			{/* Pipeline list */}
			<div className="rounded-lg border border-border bg-panel">
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h2 className="text-sm font-semibold">Pipelines</h2>
					<span className="text-xs text-muted">
						{filtered?.length ?? 0} shown
					</span>
				</div>

				{/* Filter pills */}
				<div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
					{STATUS_FILTERS.map((f) => {
						const count = counts(f.value);
						return (
							<button
								key={f.value}
								type="button"
								onClick={() => setFilter(f.value)}
								className={`rounded-full px-3 py-1 text-xs transition-colors ${
									filter === f.value
										? "border border-link bg-link/10 text-link"
										: "border border-transparent text-muted hover:text-text"
								}`}
							>
								{f.label} ({count})
							</button>
						);
					})}
				</div>

				{/* Table */}
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
								<th className="px-4 py-2.5">Status</th>
								<th className="px-4 py-2.5">Project</th>
								<th className="px-4 py-2.5">Pipeline</th>
								<th className="px-4 py-2.5">Phase</th>
								<th className="px-4 py-2.5">Started</th>
							</tr>
						</thead>
						<tbody>
							{isLoading && (
								<tr>
									<td colSpan={5} className="px-4 py-8 text-center text-muted">
										Loading...
									</td>
								</tr>
							)}
							{!isLoading && (!filtered || filtered.length === 0) && (
								<tr>
									<td colSpan={5} className="px-4 py-8 text-center text-muted">
										{filter === "all"
											? "No pipelines found."
											: `No ${filter.replace(/_/g, " ")} pipelines.`}
									</td>
								</tr>
							)}
							{filtered?.map((p: PipelineRun) => (
								<tr
									key={p.id}
									onClick={() => navigate(`/pipelines/${p.id}`)}
									className="cursor-pointer border-b border-border last:border-b-0 hover:bg-white/[0.02]"
								>
									<td className="px-4 py-2.5">
										<StatusBadge status={p.status} />
									</td>
									<td className="px-4 py-2.5 font-medium">{p.projectName}</td>
									<td className="px-4 py-2.5 text-muted">{p.pipelineName}</td>
									<td className="px-4 py-2.5 text-muted">
										Phase {p.currentPhase}
									</td>
									<td className="px-4 py-2.5 font-mono text-xs text-muted">
										{relativeTime(p.startedAt)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}
