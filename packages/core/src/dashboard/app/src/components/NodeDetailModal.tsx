import { useEffect } from "react";
import type { NodeRecord } from "../api/types";

interface Props {
	node: NodeRecord;
	onClose: () => void;
}

const statusColor: Record<string, string> = {
	online: "text-good",
	offline: "text-bad",
	degraded: "text-warn",
	unknown: "text-muted",
};

function heartbeatInfo(lastHeartbeat?: string) {
	if (!lastHeartbeat) return { text: "-", color: "text-muted" };
	const ageSec = Math.floor(
		(Date.now() - new Date(lastHeartbeat).getTime()) / 1000,
	);
	const color =
		ageSec < 30 ? "text-good" : ageSec < 120 ? "text-warn" : "text-bad";
	return { text: `${ageSec}s ago`, color };
}

export function NodeDetailModal({ node, onClose }: Props) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [onClose]);

	const hb = heartbeatInfo(node.lastHeartbeat);
	const runPct = Math.min(
		100,
		(node.activeRuns / (node.maxConcurrentRuns || 1)) * 100,
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="dialog"
			aria-modal="true"
			aria-label={`Node details: ${node.name}`}
		>
			<div className="w-full max-w-md rounded-lg border border-border bg-bg p-6">
				<div className="flex items-start justify-between">
					<h2 className="text-lg font-semibold">{node.name}</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-muted hover:bg-white/[0.05] hover:text-fg"
					>
						&#x2715;
					</button>
				</div>

				<dl className="mt-4 space-y-3 text-sm">
					<div className="flex justify-between">
						<dt className="text-muted">Type</dt>
						<dd>{node.type}</dd>
					</div>

					<div className="flex justify-between">
						<dt className="text-muted">Status</dt>
						<dd
							className={`font-semibold uppercase ${statusColor[node.status] ?? "text-muted"}`}
						>
							{node.status}
						</dd>
					</div>

					<div>
						<dt className="text-muted">Capabilities</dt>
						<dd className="mt-1 flex flex-wrap gap-1">
							{node.capabilities.length > 0 ? (
								node.capabilities.map((cap) => (
									<span
										key={cap}
										className="rounded-full bg-link/10 px-2 py-0.5 text-[10px] font-medium text-link"
									>
										{cap}
									</span>
								))
							) : (
								<span className="text-muted">-</span>
							)}
						</dd>
					</div>

					<div>
						<dt className="text-muted">Active Runs / Max Concurrent</dt>
						<dd className="mt-1 flex items-center gap-2">
							<div className="h-1.5 w-24 rounded-full bg-border">
								<div
									className="h-1.5 rounded-full bg-link"
									style={{ width: `${runPct}%` }}
								/>
							</div>
							<span className="text-xs text-muted">
								{node.activeRuns}/{node.maxConcurrentRuns ?? "\u221e"}
							</span>
						</dd>
					</div>

					<div className="flex justify-between">
						<dt className="text-muted">Last Heartbeat</dt>
						<dd className={`font-mono text-xs ${hb.color}`}>{hb.text}</dd>
					</div>

					<div className="flex justify-between">
						<dt className="text-muted">Updated At</dt>
						<dd className="font-mono text-xs text-muted">
							{new Date(node.updatedAt).toLocaleString()}
						</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}
