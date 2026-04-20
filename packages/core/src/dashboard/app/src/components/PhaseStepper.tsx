import type { PhaseSummary } from "../api/types";

function phaseLabel(phase: PhaseSummary): string {
	return phase.name ?? `Phase ${phase.phase}`;
}

function phaseClass(status: string) {
	if (status === "succeeded" || status === "completed") return "done";
	if (status === "waiting-gate") return "gate";
	if (status === "running" || status === "active") return "active";
	if (status === "failed") return "failed";
	return "pending";
}

const icons: Record<string, string> = {
	done: "\u2713",
	active: "\u25cf",
	gate: "\u23f8",
	failed: "\u2717",
	pending: "\u25cb",
};

const colors: Record<string, string> = {
	done: "border-good text-good bg-good/10",
	active: "border-warn text-warn bg-warn/10",
	gate: "border-warn text-warn bg-warn/10",
	failed: "border-bad text-bad bg-bad/10",
	pending: "border-border text-muted bg-transparent",
};

const lineColors: Record<string, string> = {
	done: "bg-good",
	active: "bg-border",
	gate: "bg-border",
	failed: "bg-border",
	pending: "bg-border",
};

export function PhaseStepper({ phases }: { phases: PhaseSummary[] }) {
	if (phases.length === 0) {
		return (
			<div className="py-4 text-center text-sm text-muted">No phase data.</div>
		);
	}

	return (
		<div className="flex items-start gap-0 overflow-x-auto pb-1">
			{phases.map((phase, i) => {
				const cls = phaseClass(phase.status);
				return (
					<div
						key={phase.phase}
						className="relative flex min-w-[90px] flex-1 flex-col items-center"
					>
						{i < phases.length - 1 && (
							<div
								className={`absolute left-1/2 top-4 h-0.5 w-full ${lineColors[cls]}`}
							/>
						)}
						<div
							className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${colors[cls]}`}
						>
							{icons[cls]}
						</div>
						<span className="mt-1.5 text-center text-[11px] text-muted">
							{phaseLabel(phase)}
						</span>
						<span
							className={`text-center text-[10px] ${cls === "done" ? "text-good" : cls === "active" || cls === "gate" ? "text-warn" : cls === "failed" ? "text-bad" : "text-muted"}`}
						>
							{phase.status.replace(/_/g, " ")}
						</span>
						{phase.runs > 0 && (
							<span className="text-[10px] text-muted">
								{phase.runs} run{phase.runs !== 1 ? "s" : ""}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
