import type { RendererProps } from "./registry";

interface Threat {
	id: string;
	title: string;
	category?: string;
	severity: string;
	description?: string;
	mitigation?: string;
}

const severityColors: Record<string, string> = {
	critical: "bg-bad/20 text-bad border-bad/30",
	high: "bg-bad/10 text-bad border-bad/20",
	medium: "bg-warn/20 text-warn border-warn/30",
	low: "bg-good/10 text-good border-good/30",
	info: "bg-link/10 text-link border-link/30",
};

const severityBadge: Record<string, string> = {
	critical: "bg-bad/20 text-bad",
	high: "bg-bad/10 text-bad",
	medium: "bg-warn/20 text-warn",
	low: "bg-good/10 text-good",
};

export function ThreatModelRenderer({ data, filename }: RendererProps) {
	const threats = (data.threats ?? []) as Threat[];

	// Group by severity for summary
	const bySeverity = new Map<string, number>();
	for (const t of threats) {
		bySeverity.set(t.severity, (bySeverity.get(t.severity) ?? 0) + 1);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
			</div>

			{/* Summary counts */}
			<div className="flex flex-wrap gap-3">
				{["critical", "high", "medium", "low"].map(
					(sev) =>
						bySeverity.has(sev) && (
							<div
								key={sev}
								className={`rounded px-2.5 py-1 text-xs font-medium ${severityBadge[sev] ?? "bg-border text-muted"}`}
							>
								{sev}: {bySeverity.get(sev)}
							</div>
						),
				)}
			</div>

			{/* Threat cards */}
			<div className="space-y-2">
				{threats.map((threat) => (
					<div
						key={threat.id}
						className={`rounded-md border px-4 py-3 ${severityColors[threat.severity] ?? "border-border"}`}
					>
						<div className="flex items-center gap-2">
							<span className="font-mono text-[11px] text-muted">
								{threat.id}
							</span>
							<span className="text-sm font-medium">{threat.title}</span>
							<span
								className={`ml-auto inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${severityBadge[threat.severity] ?? "bg-border text-muted"}`}
							>
								{threat.severity}
							</span>
						</div>
						{threat.category && (
							<div className="mt-1 text-[11px] text-muted">
								Category: {threat.category}
							</div>
						)}
						{threat.description && (
							<p className="mt-1.5 text-xs">{threat.description}</p>
						)}
						{threat.mitigation && (
							<div className="mt-2 rounded bg-good/5 px-2.5 py-1.5 text-xs">
								<span className="font-medium text-good">Mitigation:</span>{" "}
								{threat.mitigation}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
