import type { RendererProps } from "./registry";

const statusColors: Record<string, string> = {
	proposed: "bg-warn/20 text-warn",
	accepted: "bg-good/20 text-good",
	deprecated: "bg-bad/10 text-bad",
	superseded: "bg-border text-muted",
};

export function AdrRenderer({ data, filename }: RendererProps) {
	const id = data.id as string | undefined;
	const title = data.title as string | undefined;
	const status = data.status as string | undefined;
	const context = data.context as string | undefined;
	const decision = data.decision as string | undefined;
	const consequences = (data.consequences ?? []) as string[];
	const date = data.date as string | undefined;
	const alternatives = data.alternatives as string | undefined;

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 border-b border-border pb-2">
				<span className="font-mono text-xs text-muted">{filename}</span>
			</div>

			{/* ADR header */}
			<div className="rounded-lg border border-border bg-panel px-4 py-3">
				<div className="flex items-center gap-3">
					{id && <span className="font-mono text-xs text-muted">{id}</span>}
					{title && <span className="text-base font-semibold">{title}</span>}
					{status && (
						<span
							className={`ml-auto rounded px-2 py-0.5 text-[11px] font-medium ${statusColors[status] ?? "bg-border text-muted"}`}
						>
							{status}
						</span>
					)}
				</div>
				{date && <div className="mt-1 text-xs text-muted">Date: {date}</div>}
			</div>

			{/* Context */}
			{context && (
				<div>
					<div className="mb-1 text-sm font-semibold">Context</div>
					<p className="rounded border border-border px-3 py-2 text-sm">
						{context}
					</p>
				</div>
			)}

			{/* Decision */}
			{decision && (
				<div>
					<div className="mb-1 text-sm font-semibold">Decision</div>
					<p className="rounded border border-good/20 bg-good/5 px-3 py-2 text-sm">
						{decision}
					</p>
				</div>
			)}

			{/* Alternatives */}
			{alternatives && (
				<div>
					<div className="mb-1 text-sm font-semibold">Alternatives</div>
					<p className="rounded border border-border px-3 py-2 text-sm text-muted">
						{alternatives}
					</p>
				</div>
			)}

			{/* Consequences */}
			{consequences.length > 0 && (
				<div>
					<div className="mb-1 text-sm font-semibold">Consequences</div>
					<ul className="list-inside list-disc space-y-1 pl-1 text-sm">
						{consequences.map((c) => (
							<li key={c}>{c}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
