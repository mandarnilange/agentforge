import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { ConversationEntry } from "../../domain/ports/execution-backend.port.js";
import type { IStateStore } from "../../domain/ports/state-store.port.js";

export function registerLogsCommand(
	program: Command,
	store: IStateStore,
): void {
	program
		.command("logs <run-id>")
		.description("Stream or display logs for an agent run")
		.option("--conversation", "Show captured conversation (LLM messages)")
		.action(async (runId: string, options: { conversation?: boolean }) => {
			// Accept either an agent run ID or a pipeline run ID
			const agentRun = await store.getAgentRun(runId);

			if (!agentRun) {
				// Try treating it as a pipeline run ID — show all agent runs for it
				const pipeline = await store.getPipelineRun(runId);
				if (pipeline) {
					const runs = await store.listAgentRuns(runId);
					if (runs.length === 0) {
						console.log(`Pipeline ${runId} has no agent runs yet.`);
						return;
					}
					console.log(
						`Pipeline: ${pipeline.projectName} / ${pipeline.pipelineName}`,
					);
					console.log(`Status:   ${pipeline.status}`);
					console.log(`Phase:    ${pipeline.currentPhase}`);
					console.log();
					for (const run of runs) {
						console.log(
							`  Phase ${run.phase}  ${run.agentName.padEnd(12)}  ${run.status.padEnd(12)}  ${run.id}`,
						);
					}
					console.log();
					console.log(
						`Run 'logs <agent-run-id>' to see details for a specific run.`,
					);
					return;
				}
				console.error(`No agent run or pipeline run found with ID: ${runId}`);
				process.exitCode = 1;
				return;
			}

			if (options.conversation) {
				console.log(`Conversation log for agent run: ${runId}`);
				console.log(`Agent:    ${agentRun.agentName}`);
				console.log(`Phase:    ${agentRun.phase}`);
				console.log(`Status:   ${agentRun.status}`);
				if (agentRun.revisionNotes) {
					console.log();
					console.log("## Revision Notes");
					console.log(agentRun.revisionNotes);
				}

				// Try store first, fall back to JSONL sidecar for legacy runs
				let conversationLog = await store.getConversationLog(runId);
				if (conversationLog.length === 0) {
					conversationLog = loadConversationLog(
						agentRun.outputArtifactIds,
						agentRun.agentName,
					);
				}

				if (conversationLog.length > 0) {
					console.log();
					renderConversation(conversationLog);
					if (agentRun.tokenUsage) {
						console.log();
						console.log(
							`Token usage: ${agentRun.tokenUsage.inputTokens} in / ${agentRun.tokenUsage.outputTokens} out`,
						);
					}
				} else {
					console.log();
					console.log(
						"(No conversation log found — run the agent via pipeline to capture dialogue)",
					);
				}
			} else {
				console.log(`Logs for agent run: ${runId}`);
				console.log(`Agent:    ${agentRun.agentName}`);
				console.log(`Pipeline: ${agentRun.pipelineRunId}`);
				console.log(`Phase:    ${agentRun.phase}`);
				console.log(`Node:     ${agentRun.nodeName}`);
				console.log(`Status:   ${agentRun.status}`);
				console.log(`Started:  ${agentRun.startedAt}`);
				if (agentRun.completedAt) {
					console.log(`Completed: ${agentRun.completedAt}`);
					if (agentRun.durationMs) {
						console.log(
							`Duration: ${(agentRun.durationMs / 1000).toFixed(1)}s`,
						);
					}
				}
				if (agentRun.error) {
					console.log(`Error:    ${agentRun.error}`);
				}
				if (agentRun.provider) {
					console.log(`Provider: ${agentRun.provider}`);
				}
				if (agentRun.modelName) {
					console.log(`Model:    ${agentRun.modelName}`);
				}
				if (agentRun.tokenUsage) {
					console.log(
						`Tokens:   ${agentRun.tokenUsage.inputTokens} in / ${agentRun.tokenUsage.outputTokens} out`,
					);
				}
				if (agentRun.costUsd !== undefined) {
					console.log(`Cost:     $${agentRun.costUsd.toFixed(6)}`);
				}
				if (agentRun.outputArtifactIds.length > 0) {
					console.log("Output artifacts:");
					for (const f of agentRun.outputArtifactIds) {
						console.log(`  - ${f}`);
					}
				}
			}
		});
}

/** Locates the JSONL conversation file for an agent run and parses it. */
function loadConversationLog(
	outputArtifactIds: string[],
	agentName: string,
): ConversationEntry[] {
	// Try to derive the output directory from known artifact paths
	const firstArtifact = outputArtifactIds[0];
	if (firstArtifact) {
		const dir = firstArtifact.includes("/")
			? firstArtifact.substring(0, firstArtifact.lastIndexOf("/"))
			: ".";
		const logPath = join(dir, `${agentName}-conversation.jsonl`);
		if (existsSync(logPath)) {
			return parseJsonl(logPath);
		}
	}
	return [];
}

function parseJsonl(filePath: string): ConversationEntry[] {
	try {
		return readFileSync(filePath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as ConversationEntry);
	} catch {
		return [];
	}
}

function renderConversation(entries: ConversationEntry[]): void {
	for (const entry of entries) {
		switch (entry.role) {
			case "user":
				console.log("┌─ USER ─────────────────────────────");
				console.log(
					entry.content.length > 2000
						? `${entry.content.slice(0, 2000)}\n… (truncated)`
						: entry.content,
				);
				console.log("└────────────────────────────────────");
				break;
			case "assistant":
				console.log("┌─ ASSISTANT ────────────────────────");
				console.log(
					entry.content.length > 4000
						? `${entry.content.slice(0, 4000)}\n… (truncated)`
						: entry.content,
				);
				console.log("└────────────────────────────────────");
				break;
			case "tool_call":
				console.log(`┌─ TOOL CALL: ${entry.name ?? "unknown"} ──────────`);
				console.log(entry.content);
				console.log("└────────────────────────────────────");
				break;
			case "tool_result":
				console.log("┌─ TOOL RESULT ──────────────────────");
				console.log(
					entry.content.length > 1000
						? `${entry.content.slice(0, 1000)}\n… (truncated)`
						: entry.content,
				);
				console.log("└────────────────────────────────────");
				break;
		}
		console.log();
	}
}
