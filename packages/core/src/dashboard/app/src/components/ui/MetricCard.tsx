export function MetricCard({
	label,
	value,
}: {
	label: string;
	value: string | number;
}) {
	return (
		<div className="rounded-lg border border-border bg-panel p-4">
			<div className="text-2xl font-bold">{value}</div>
			<div className="mt-1 text-xs text-muted">{label}</div>
		</div>
	);
}
