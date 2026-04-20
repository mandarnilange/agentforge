import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import { usePendingGates } from "../api/hooks";
import type { PendingGate } from "../api/types";
import { StatusBadge } from "../components/ui/StatusBadge";
import { ArtifactViewer } from "../renderers/ArtifactViewer";

function phaseLabel(
	num: number,
	name: string | undefined,
): string {
	return name ? `${name} (Phase ${num})` : `Phase ${num}`;
}

function GateTaskCard({ gate }: { gate: PendingGate }) {
	const queryClient = useQueryClient();
	const [acting, setActing] = useState(false);
	const [showRevise, setShowRevise] = useState(false);
	const [showArtifacts, setShowArtifacts] = useState(false);
	const [notes, setNotes] = useState("");
	const [reviewer, setReviewer] = useState("");

	const doAction = async (action: "approve" | "reject" | "revise") => {
		setActing(true);
		try {
			const body: Record<string, string> = {};
			if (reviewer) body.reviewer = reviewer;
			if (action === "revise") body.notes = notes;
			await api.gateAction(gate.id, action, body);
			await queryClient.invalidateQueries({ queryKey: ["pending-gates"] });
			await queryClient.invalidateQueries({ queryKey: ["summary"] });
		} finally {
			setActing(false);
		}
	};

	return (
		<div className="rounded-lg border border-border bg-panel">
			<div className="flex items-start justify-between px-4 py-3">
				<div>
					<div className="font-medium">{gate.projectName}</div>
					<div className="mt-0.5 text-xs text-muted">
						{gate.pipelineName} &middot;{" "}
						{phaseLabel(gate.phaseCompleted, gate.phaseCompletedName)} →{" "}
						{phaseLabel(gate.phaseNext, gate.phaseNextName)}
					</div>
				</div>
				<StatusBadge status={gate.status} />
			</div>

			{/* Artifacts to Review */}
			<div className="border-t border-border">
				<button
					type="button"
					onClick={() => setShowArtifacts(!showArtifacts)}
					className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-white/[0.02]"
				>
					<span
						className="text-[10px] transition-transform"
						style={{ transform: showArtifacts ? "rotate(90deg)" : "" }}
					>
						&#9654;
					</span>
					<span>
						Artifacts to Review
						{gate.artifactVersionIds.length > 0 &&
							` (${gate.artifactVersionIds.length})`}
					</span>
				</button>
				{showArtifacts && (
					<div className="border-t border-border bg-bg/30">
						{gate.artifactVersionIds.length === 0 && (
							<div className="px-4 py-3 text-xs text-muted">
								No artifacts linked to this gate.
							</div>
						)}
						{gate.artifactVersionIds.map((path) => (
							<ArtifactViewer key={path} path={path} />
						))}
					</div>
				)}
			</div>

			{/* Reviewer input */}
			<div className="border-t border-border px-4 py-2">
				<input
					type="text"
					placeholder="Reviewer name (optional)"
					value={reviewer}
					onChange={(e) => setReviewer(e.target.value)}
					className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-link"
				/>
			</div>

			{/* Revision notes (toggled) */}
			{showRevise && (
				<div className="border-t border-border px-4 py-2">
					<textarea
						placeholder="Revision notes..."
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
						rows={3}
						className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-link"
					/>
				</div>
			)}

			{/* Actions */}
			<div className="flex gap-2 border-t border-border px-4 py-2.5">
				<button
					type="button"
					onClick={() => doAction("approve")}
					disabled={acting}
					className="rounded bg-good/20 px-3 py-1 text-xs font-medium text-good hover:bg-good/30 disabled:opacity-50"
				>
					Approve
				</button>
				<button
					type="button"
					onClick={() => doAction("reject")}
					disabled={acting}
					className="rounded bg-bad/20 px-3 py-1 text-xs font-medium text-bad hover:bg-bad/30 disabled:opacity-50"
				>
					Reject
				</button>
				<button
					type="button"
					onClick={() => {
						if (showRevise && notes) {
							doAction("revise");
						} else {
							setShowRevise(!showRevise);
						}
					}}
					disabled={acting}
					className="rounded bg-warn/20 px-3 py-1 text-xs font-medium text-warn hover:bg-warn/30 disabled:opacity-50"
				>
					{showRevise && notes ? "Submit Revision" : "Request Revision"}
				</button>
			</div>
		</div>
	);
}

export function Gates() {
	const { data: gates, isLoading } = usePendingGates();

	return (
		<div className="space-y-6">
			<h1 className="text-xl font-semibold">Pending Gates</h1>

			{isLoading && (
				<div className="py-8 text-center text-sm text-muted">Loading...</div>
			)}

			{gates && gates.length === 0 && (
				<div className="py-8 text-center text-sm text-muted">
					No pending gates. All clear!
				</div>
			)}

			{gates && gates.length > 0 && (
				<div className="space-y-3">
					{gates.map((gate) => (
						<GateTaskCard key={gate.id} gate={gate} />
					))}
				</div>
			)}
		</div>
	);
}
