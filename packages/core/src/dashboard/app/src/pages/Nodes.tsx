import { useState } from "react";
import { useNodes } from "../api/hooks";
import type { NodeRecord } from "../api/types";
import { NodeDetailModal } from "../components/NodeDetailModal";

export function Nodes() {
	const { data: nodes, isLoading } = useNodes();
	const [selectedNode, setSelectedNode] = useState<NodeRecord | null>(null);

	return (
		<div className="space-y-6">
			<h1 className="text-xl font-semibold">Nodes</h1>

			<div className="rounded-lg border border-border bg-panel">
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
								<th className="px-4 py-2.5">Name</th>
								<th className="px-4 py-2.5">Status</th>
								<th className="px-4 py-2.5">Type</th>
								<th className="px-4 py-2.5">Runs</th>
								<th className="px-4 py-2.5">Heartbeat</th>
								<th className="px-4 py-2.5">Capabilities</th>
							</tr>
						</thead>
						<tbody>
							{isLoading && (
								<tr>
									<td colSpan={6} className="px-4 py-8 text-center text-muted">
										Loading...
									</td>
								</tr>
							)}
							{!isLoading && (!nodes || nodes.length === 0) && (
								<tr>
									<td colSpan={6} className="px-4 py-8 text-center text-muted">
										No nodes registered.
									</td>
								</tr>
							)}
							{nodes?.map((n) => {
								const heartbeatAge = n.lastHeartbeat
									? Math.floor(
											(Date.now() - new Date(n.lastHeartbeat).getTime()) / 1000,
										)
									: null;
								const heartbeatColor =
									heartbeatAge === null
										? "text-muted"
										: heartbeatAge < 30
											? "text-good"
											: heartbeatAge < 120
												? "text-warn"
												: "text-bad";
								return (
									<tr
										key={n.name}
										className="cursor-pointer border-b border-border last:border-b-0 hover:bg-white/[0.03]"
										onClick={() => setSelectedNode(n)}
									>
										<td className="px-4 py-2.5 font-mono text-xs font-medium">
											{n.name}
										</td>
										<td className="px-4 py-2.5">
											<span
												className={`text-xs font-semibold uppercase ${n.status === "online" ? "text-good" : n.status === "offline" ? "text-bad" : "text-muted"}`}
											>
												{n.status}
											</span>
										</td>
										<td className="px-4 py-2.5 text-muted">{n.type}</td>
										<td className="px-4 py-2.5">
											<div className="flex items-center gap-2">
												<div className="h-1.5 w-16 rounded-full bg-border">
													<div
														className="h-1.5 rounded-full bg-link"
														style={{
															width: `${Math.min(100, (n.activeRuns / (n.maxConcurrentRuns || 1)) * 100)}%`,
														}}
													/>
												</div>
												<span className="text-xs text-muted">
													{n.activeRuns}/{n.maxConcurrentRuns ?? "\u221e"}
												</span>
											</div>
										</td>
										<td
											className={`px-4 py-2.5 font-mono text-xs ${heartbeatColor}`}
										>
											{heartbeatAge !== null ? `${heartbeatAge}s ago` : "-"}
										</td>
										<td className="px-4 py-2.5">
											<div className="flex flex-wrap gap-1">
												{n.capabilities.length > 0 ? (
													n.capabilities.map((cap) => (
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
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			{selectedNode && (
				<NodeDetailModal
					node={selectedNode}
					onClose={() => setSelectedNode(null)}
				/>
			)}
		</div>
	);
}
