import { useCostSummary } from "../api/hooks";

function CostBar({
	label,
	value,
	maxValue,
}: {
	label: string;
	value: number;
	maxValue: number;
}) {
	const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
	return (
		<div className="flex items-center gap-2 text-xs">
			<span className="w-24 truncate text-muted" title={label}>
				{label}
			</span>
			<div className="h-1.5 flex-1 rounded-full bg-border">
				<div
					className="h-1.5 rounded-full bg-link"
					style={{ width: `${Math.max(pct, 1)}%` }}
				/>
			</div>
			<span className="w-16 text-right font-mono text-muted">
				${value.toFixed(4)}
			</span>
		</div>
	);
}

function CostSection({
	title,
	items,
}: {
	title: string;
	items: Array<{ label: string; cost: number }>;
}) {
	const max = items.reduce((m, i) => Math.max(m, i.cost), 0);
	if (items.length === 0) return null;
	return (
		<div>
			<h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
				{title}
			</h4>
			<div className="space-y-1.5">
				{items.map((item) => (
					<CostBar
						key={item.label}
						label={item.label}
						value={item.cost}
						maxValue={max}
					/>
				))}
			</div>
		</div>
	);
}

export function CostBreakdown() {
	const { data: cost, isLoading } = useCostSummary();

	if (isLoading || !cost) return null;
	if (cost.totalCostUsd === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-panel p-4">
			<div className="mb-4 flex items-baseline justify-between">
				<h3 className="text-sm font-semibold">Cost Breakdown</h3>
				<span className="font-mono text-sm font-semibold text-link">
					${cost.totalCostUsd.toFixed(4)}
				</span>
			</div>
			<div className="space-y-4">
				<CostSection
					title="By Pipeline"
					items={cost.byPipeline.map((p) => ({
						label: p.name,
						cost: p.cost,
					}))}
				/>
				<CostSection
					title="By Agent"
					items={cost.byAgent.map((a) => ({
						label: a.name,
						cost: a.cost,
					}))}
				/>
				<CostSection
					title="By Model"
					items={cost.byModel.map((m) => ({
						label: `${m.provider}/${m.model}`,
						cost: m.cost,
					}))}
				/>
			</div>
		</div>
	);
}
