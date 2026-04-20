import { metrics } from "@opentelemetry/api";

export interface AgentMetrics {
	recordAgentRun(
		agentName: string,
		durationMs: number,
		tokens: { input: number; output: number },
		status: "success" | "error",
	): void;
	recordToolCall(agentName: string, toolName: string, durationMs: number): void;
	recordNodeHeartbeat(nodeName: string, status: "online" | "offline"): void;
	recordNodeActiveRuns(nodeName: string, count: number): void;
	recordRunCost(
		agentName: string,
		provider: string,
		model: string,
		costUsd: number,
	): void;
}

export function createMetricsRecorder(): AgentMetrics {
	const meter = metrics.getMeter("sdlc-agent");

	const runDuration = meter.createHistogram("sdlc.agent.run.duration", {
		description: "Agent run duration in milliseconds",
		unit: "ms",
	});
	const runCount = meter.createCounter("sdlc.agent.run.count", {
		description: "Number of agent runs",
	});
	const tokenUsage = meter.createHistogram("sdlc.agent.tokens", {
		description: "Token usage per agent run",
	});
	const toolCallDuration = meter.createHistogram(
		"sdlc.agent.tool_call.duration",
		{
			description: "Tool call duration in milliseconds",
			unit: "ms",
		},
	);
	const toolCallCount = meter.createCounter("sdlc.agent.tool_call.count", {
		description: "Number of tool calls",
	});
	const nodeHeartbeatCount = meter.createCounter("sdlc.node.heartbeat.count", {
		description: "Node heartbeat events",
	});
	const nodeActiveRuns = meter.createUpDownCounter("sdlc.node.active_runs", {
		description: "Active agent runs per node",
	});
	const runCost = meter.createHistogram("sdlc.run.cost_usd", {
		description: "Estimated USD cost per agent run",
		unit: "USD",
	});

	return {
		recordAgentRun(agentName, durationMs, tokens, status) {
			const labels = { "sdlc.agent.name": agentName, status };
			runDuration.record(durationMs, labels);
			runCount.add(1, labels);
			tokenUsage.record(tokens.input, { ...labels, token_type: "input" });
			tokenUsage.record(tokens.output, { ...labels, token_type: "output" });
		},

		recordToolCall(agentName, toolName, durationMs) {
			const labels = { "sdlc.agent.name": agentName, "tool.name": toolName };
			toolCallDuration.record(durationMs, labels);
			toolCallCount.add(1, labels);
		},

		recordNodeHeartbeat(nodeName, status) {
			nodeHeartbeatCount.add(1, {
				"sdlc.node.name": nodeName,
				"sdlc.node.status": status,
			});
		},

		recordNodeActiveRuns(nodeName, count) {
			nodeActiveRuns.add(count, { "sdlc.node.name": nodeName });
		},

		recordRunCost(agentName, provider, model, costUsd) {
			runCost.record(costUsd, {
				"sdlc.agent.name": agentName,
				"sdlc.model.provider": provider,
				"sdlc.model.name": model,
			});
		},
	};
}
