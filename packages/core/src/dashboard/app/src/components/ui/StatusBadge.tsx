const colorMap: Record<string, string> = {
	succeeded: "text-good border-good",
	completed: "text-good border-good",
	approved: "text-good border-good",
	online: "text-good border-good",
	running: "text-warn border-warn",
	active: "text-warn border-warn",
	pending: "text-warn border-warn",
	paused_at_gate: "text-purple border-purple",
	"waiting-gate": "text-purple border-purple",
	failed: "text-bad border-bad",
	rejected: "text-bad border-bad",
	offline: "text-bad border-bad",
	revision_requested: "text-purple border-purple",
	cancelled: "text-muted border-muted",
};

export function StatusBadge({ status }: { status: string }) {
	const color = colorMap[status] ?? "text-muted border-muted";
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${color}`}
		>
			{status.replace(/_/g, " ")}
		</span>
	);
}
