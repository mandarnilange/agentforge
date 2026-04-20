import { useState } from "react";
import { useRunConversation } from "../api/hooks";
import type { AgentRunRecord } from "../api/types";
import { ArtifactViewer } from "../renderers/ArtifactViewer";
import { ElapsedTime } from "./ElapsedTime";
import { StatusBadge } from "./ui/StatusBadge";

const roleColors: Record<string, string> = {
	system: "text-warn",
	user: "text-link",
	assistant: "text-good",
	tool_call: "text-purple",
	tool_result: "text-purple",
};

function ConversationMessage({
	msg,
}: {
	msg: { role: string; content: string; name?: string; timestamp?: number };
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="border-b border-border px-4 py-2.5 last:border-b-0">
			<div
				className={`text-[10px] font-bold uppercase tracking-wider ${roleColors[msg.role] ?? "text-muted"}`}
			>
				{msg.role}
				{msg.name ? ` · ${msg.name}` : ""}
				<span className="ml-2 font-normal text-muted normal-case">
					{msg.content.length.toLocaleString()} chars
				</span>
			</div>
			<pre
				className={`mt-1 overflow-auto whitespace-pre-wrap break-words font-mono text-xs ${expanded ? "" : "max-h-48"}`}
			>
				{msg.content}
			</pre>
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="mt-1 text-[10px] text-link hover:underline"
			>
				{expanded ? "Collapse" : "Expand"}
			</button>
		</div>
	);
}

/** Map provider-agnostic TokenUsageExtra.kind to a compact UI label. */
function shortExtraLabel(kind: string): string {
	switch (kind) {
		case "anthropic.cacheRead":
			return "cache read";
		case "anthropic.cacheWrite5m":
			return "cache write (5m)";
		case "anthropic.cacheWrite1h":
			return "cache write (1h)";
		case "openai.reasoning":
			return "reasoning";
		case "gemini.thinking":
			return "thinking";
		default:
			// Strip namespace prefix if present, leave kind otherwise.
			return kind.includes(".") ? kind.split(".").pop()! : kind;
	}
}

/** Tooltip: full breakdown for the token pill. */
function formatTokenBreakdown(usage: {
	inputTokens: number;
	outputTokens: number;
	extras?: Array<{ kind: string; tokens: number; costMultiplier: number }>;
}): string {
	const lines = [
		`Input: ${usage.inputTokens.toLocaleString()}`,
		`Output: ${usage.outputTokens.toLocaleString()}`,
	];
	for (const extra of usage.extras ?? []) {
		lines.push(
			`${shortExtraLabel(extra.kind)}: ${extra.tokens.toLocaleString()} (×${extra.costMultiplier} input)`,
		);
	}
	return lines.join("\n");
}

function BudgetBar({
	used,
	budget,
	formatLabel,
}: {
	used: number;
	budget: number;
	formatLabel?: (used: number, budget: number) => string;
}) {
	const pct = Math.min(100, Math.round((used / budget) * 100));
	const exceeded = used >= budget;
	const barColor = exceeded
		? "bg-bad"
		: pct >= 80
			? "bg-warn"
			: "bg-good";

	const label = formatLabel
		? formatLabel(used, budget)
		: exceeded
			? "budget exceeded"
			: `${pct}% of ${(budget / 1000).toFixed(0)}k`;

	return (
		<span className="flex items-center gap-1.5">
			<span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-border">
				<span
					className={`block h-full ${barColor} transition-all`}
					style={{ width: `${pct}%` }}
				/>
			</span>
			<span className={exceeded ? "font-semibold text-bad" : ""}>
				{label}
			</span>
		</span>
	);
}

export function RunCard({ run }: { run: AgentRunRecord }) {
	const isActive =
		run.status === "running" ||
		run.status === "pending" ||
		run.status === "scheduled";
	// Auto-expand conversation for active tasks so logs are visible
	const [showConv, setShowConv] = useState(isActive);
	const [showArt, setShowArt] = useState(false);

	const { data: conversation, isLoading: convLoading } = useRunConversation(
		run.id,
		showConv,
		isActive, // live-refresh every 3s for running agents
	);

	const fmt = (n: number) => n.toLocaleString();

	return (
		<div className="rounded-lg border border-border">
			{/* Summary row */}
			<div className="flex items-center gap-3 px-4 py-3">
				<span className="font-medium">{run.agentName}</span>
				<StatusBadge status={run.status} />
				{run.exitReason === "timeout" && (
					<span
						className="rounded bg-warn/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warn"
						title={
							run.durationMs
								? `Wall-clock timeout after ${Math.round(run.durationMs / 1000)}s — see ADR-0003`
								: "Wall-clock timeout — see ADR-0003"
						}
					>
						{run.durationMs
							? `Timeout: ${Math.round(run.durationMs / 1000)}s`
							: "Timeout"}
					</span>
				)}
				<span className="ml-auto font-mono text-xs text-muted">
					{run.costUsd != null ? `$${run.costUsd.toFixed(6)}` : ""}
				</span>
			</div>

			{/* Meta info */}
			<div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted">
				<span>Phase {run.phase}</span>
				<span>{run.nodeName}</span>
				{run.provider && (
					<span>
						{run.provider}/{run.modelName}
					</span>
				)}
				{run.tokenUsage && (
					<span title={formatTokenBreakdown(run.tokenUsage)}>
						{fmt(run.tokenUsage.inputTokens)} in /{" "}
						{fmt(run.tokenUsage.outputTokens)} out
						{run.tokenUsage.extras?.map((extra) => (
							<span key={extra.kind} className="ml-1.5">
								/ {fmt(extra.tokens)} {shortExtraLabel(extra.kind)}
							</span>
						))}
					</span>
				)}
				{run.budgetTokens != null && run.tokenUsage && (
					<BudgetBar
						used={run.tokenUsage.inputTokens + run.tokenUsage.outputTokens}
						budget={run.budgetTokens}
					/>
				)}
				{run.budgetCostUsd != null && run.costUsd != null && (
					<BudgetBar
						used={run.costUsd}
						budget={run.budgetCostUsd}
						formatLabel={(used, budget) =>
							used >= budget
								? "cost exceeded"
								: `$${used.toFixed(4)} / $${budget.toFixed(2)}`
						}
					/>
				)}
				{run.durationMs != null && (
					<span>{(run.durationMs / 1000).toFixed(1)}s</span>
				)}
				{isActive && run.startedAt && (
					<span className="font-medium text-warn">
						Elapsed: <ElapsedTime startedAt={run.startedAt} />
					</span>
				)}
			</div>

			{/* Error */}
			{run.error && (
				<div className="mx-4 mb-3 rounded border border-bad/30 bg-bad/5 p-2.5 text-xs text-bad">
					{run.error}
				</div>
			)}

			{/* Expandable sections */}
			<div className="border-t border-border">
				{/* Conversation */}
				<button
					type="button"
					onClick={() => setShowConv(!showConv)}
					className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-white/[0.02]"
				>
					<span
						className="text-[10px] transition-transform"
						style={{ transform: showConv ? "rotate(90deg)" : "" }}
					>
						&#9654;
					</span>
					<span>Conversation</span>
				</button>
				{showConv && (
					<div className="border-t border-border">
						{convLoading && (
							<div className="px-4 py-3 text-xs text-muted">Loading...</div>
						)}
						{conversation && conversation.length === 0 && (
							<div className="px-4 py-3 text-xs text-muted">No messages.</div>
						)}
						{conversation?.map((msg) => (
							<ConversationMessage
								key={`${msg.role}-${msg.timestamp ?? msg.content.slice(0, 40)}`}
								msg={msg}
							/>
						))}
					</div>
				)}

				{/* Artifacts */}
				<button
					type="button"
					onClick={() => setShowArt(!showArt)}
					className="flex w-full items-center gap-2 border-t border-border px-4 py-2 text-left text-sm hover:bg-white/[0.02]"
				>
					<span
						className="text-[10px] transition-transform"
						style={{ transform: showArt ? "rotate(90deg)" : "" }}
					>
						&#9654;
					</span>
					<span>
						Artifacts
						{run.outputArtifactIds.length > 0 &&
							` (${run.outputArtifactIds.length})`}
					</span>
				</button>
				{showArt && (
					<div className="border-t border-border">
						{run.outputArtifactIds.length === 0 && (
							<div className="px-4 py-3 text-xs text-muted">No artifacts.</div>
						)}
						{run.outputArtifactIds.map((path) => (
							<ArtifactViewer key={path} path={path} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
