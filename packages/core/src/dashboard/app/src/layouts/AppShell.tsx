import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useStatus, useSummary } from "../api/hooks";
import { type SSEStatus, useSSE } from "../api/useSSE";
import { NewPipelineModal } from "../components/NewPipelineModal";
import {
	REFRESH_OPTIONS,
	type RefreshOption,
	useRefreshInterval,
} from "../hooks/useRefreshInterval";

function sseStatusColor(status: SSEStatus): string {
	switch (status) {
		case "connected":
			return "bg-good";
		case "connecting":
			return "bg-warn";
		case "disconnected":
			return "bg-bad";
	}
}

function sseStatusTitle(status: SSEStatus): string {
	switch (status) {
		case "connected":
			return "Connected";
		case "connecting":
			return "Connecting...";
		case "disconnected":
			return "Disconnected";
	}
}

const navItems = [
	{ to: "/", label: "Overview", end: true },
	{ to: "/gates", label: "Gates" },
	{ to: "/nodes", label: "Nodes" },
	{ to: "/costs", label: "Costs" },
	{ to: "/settings", label: "Settings" },
];

export function AppShell() {
	const { data: status } = useStatus();
	const { data: summary } = useSummary();
	const pendingGates = summary?.pendingGates ?? 0;
	const [showNewPipeline, setShowNewPipeline] = useState(false);
	const { interval, setInterval } = useRefreshInterval();
	const { status: sseStatus } = useSSE();

	return (
		<div className="flex h-screen flex-col">
			{/* Header */}
			<header className="sticky top-0 z-50 flex items-center gap-4 border-b border-border bg-bg/95 px-6 py-3 backdrop-blur">
				<h1 className="text-base font-semibold text-text">
					SDLC Control Plane
				</h1>
				<nav className="ml-8 flex items-center gap-1">
					{navItems.map((item) => (
						<NavLink
							key={item.to}
							to={item.to}
							end={item.to === "/"}
							className={({ isActive }) =>
								`rounded-md px-3 py-1.5 text-sm transition-colors ${
									isActive
										? "bg-link/10 text-link"
										: "text-muted hover:text-text"
								}`
							}
						>
							{item.label}
							{item.label === "Gates" && pendingGates > 0 && (
								<span className="ml-1.5 inline-flex items-center rounded-full bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">
									{pendingGates}
								</span>
							)}
						</NavLink>
					))}
				</nav>
				<div className="ml-auto flex items-center gap-3">
					<button
						type="button"
						onClick={() => setShowNewPipeline(true)}
						disabled={status?.readOnly}
						className={`rounded px-3 py-1.5 text-xs font-medium text-white ${
							status?.readOnly
								? "cursor-not-allowed bg-muted/50"
								: "bg-link hover:bg-link/80"
						}`}
						title={
							status?.readOnly
								? "Execution disabled — set ANTHROPIC_API_KEY"
								: undefined
						}
					>
						+ New Pipeline
					</button>
					<select
						value={interval}
						onChange={(e) =>
							setInterval(Number(e.target.value) as RefreshOption)
						}
						className="rounded border border-border bg-bg px-2 py-1 text-xs text-muted"
					>
						{REFRESH_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
					<div
						className={`h-2.5 w-2.5 rounded-full ${sseStatusColor(sseStatus)}`}
						title={sseStatusTitle(sseStatus)}
					/>
				</div>
			</header>

			{/* Read-only mode banner */}
			{status?.readOnly && (
				<div className="border-b border-warn/30 bg-warn/10 px-6 py-2 text-center text-sm text-warn">
					Read-only mode — ANTHROPIC_API_KEY not configured. Agent execution is disabled.
				</div>
			)}

			{/* Main content */}
			<main className="flex-1 overflow-y-auto p-6">
				<div className="mx-auto max-w-[1400px]">
					<Outlet />
				</div>
			</main>

			{/* New Pipeline Modal */}
			<NewPipelineModal
				open={showNewPipeline}
				onClose={() => setShowNewPipeline(false)}
			/>
		</div>
	);
}
