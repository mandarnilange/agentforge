import { useCostSummary } from "../api/hooks";
import { CostBreakdown } from "../components/CostBreakdown";

export function Costs() {
	const { data: cost, isLoading, isError, error } = useCostSummary();

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Costs</h1>

			{isLoading && <div className="text-sm text-muted">Loading…</div>}
			{isError && (
				<div className="rounded-lg border border-bad/40 bg-bad/10 p-6 text-sm text-bad">
					Failed to load cost data: {error?.message ?? "Unknown error"}
				</div>
			)}
			{!isLoading && !isError && (!cost || cost.totalCostUsd === 0) && (
				<div className="rounded-lg border border-border bg-panel p-6 text-sm text-muted">
					No cost recorded yet. Runs with token usage will show up here.
				</div>
			)}
			{!isLoading && !isError && cost && cost.totalCostUsd > 0 && (
				<CostBreakdown />
			)}
		</div>
	);
}
