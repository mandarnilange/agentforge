import { useAuditLog } from "../api/hooks";

const ACTION_ICONS: Record<string, string> = {
	"gate.approved": "\u2713",
	"gate.rejected": "\u2717",
	"gate.revision_requested": "\u21BA",
	"pipeline.stopped": "\u25A0",
	"pipeline.rehydrated": "\u21BB",
	"run.retried": "\u21BB",
};

const ACTION_COLORS: Record<string, string> = {
	"gate.approved": "bg-good/20 text-good",
	"gate.rejected": "bg-bad/20 text-bad",
	"gate.revision_requested": "bg-warn/20 text-warn",
	"pipeline.stopped": "bg-bad/20 text-bad",
};

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

export function AuditTimeline({ pipelineId }: { pipelineId: string }) {
	const { data: entries, isLoading } = useAuditLog(pipelineId);

	if (isLoading)
		return <div className="text-xs text-muted">Loading audit log...</div>;
	if (!entries || entries.length === 0) return null;

	return (
		<div className="rounded-lg border border-border bg-panel p-4">
			<h3 className="mb-3 text-sm font-semibold">Audit Trail</h3>
			<div className="space-y-0">
				{entries.map((entry) => {
					const icon = ACTION_ICONS[entry.action] ?? "\u2022";
					const colorClass =
						ACTION_COLORS[entry.action] ?? "bg-muted/20 text-muted";
					return (
						<div key={entry.id} className="flex gap-3 py-2">
							<div className="flex flex-col items-center">
								<div
									className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${colorClass}`}
								>
									{icon}
								</div>
								<div className="w-px flex-1 bg-border" />
							</div>
							<div className="flex-1 pb-2">
								<div className="flex items-baseline gap-2">
									<span className="text-xs font-semibold">{entry.actor}</span>
									<span className="text-xs text-muted">{entry.action}</span>
								</div>
								<div className="text-[10px] text-muted">
									{entry.resourceType}/{entry.resourceId} &middot;{" "}
									{relativeTime(entry.createdAt)}
								</div>
								{entry.metadata &&
								typeof entry.metadata === "object" &&
								"comment" in (entry.metadata as Record<string, unknown>) ? (
									<div className="mt-1 text-xs text-muted italic">
										&ldquo;
										{(entry.metadata as Record<string, string>).comment}
										&rdquo;
									</div>
								) : null}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
