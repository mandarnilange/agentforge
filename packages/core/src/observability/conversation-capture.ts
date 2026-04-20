export interface ConversationMessage {
	role: "user" | "assistant" | "tool_call" | "tool_result";
	content: string;
	timestamp: number;
	toolName?: string;
	toolCallId?: string;
}

export interface CapturedConversation {
	agentId: string;
	runId: string;
	messages: ConversationMessage[];
	tokenUsage: { inputTokens: number; outputTokens: number };
	durationMs: number;
}

export interface ConversationCapture {
	addMessage(msg: ConversationMessage): void;
	setTokenUsage(usage: { inputTokens: number; outputTokens: number }): void;
	setDuration(ms: number): void;
	finish(): CapturedConversation;
}

export function captureConversation(opts: {
	agentId: string;
	runId: string;
}): ConversationCapture {
	const messages: ConversationMessage[] = [];
	let tokenUsage = { inputTokens: 0, outputTokens: 0 };
	let durationMs = 0;

	return {
		addMessage(msg) {
			messages.push(msg);
		},
		setTokenUsage(usage) {
			tokenUsage = usage;
		},
		setDuration(ms) {
			durationMs = ms;
		},
		finish() {
			return {
				agentId: opts.agentId,
				runId: opts.runId,
				messages: [...messages],
				tokenUsage,
				durationMs,
			};
		},
	};
}

export function formatConversation(conv: CapturedConversation): string {
	const lines: string[] = [
		`Conversation: agent=${conv.agentId} run=${conv.runId}`,
		`Duration: ${conv.durationMs}ms | Tokens: in=${conv.tokenUsage.inputTokens} out=${conv.tokenUsage.outputTokens}`,
		"",
	];

	for (const msg of conv.messages) {
		switch (msg.role) {
			case "user":
				lines.push(`[USER]`);
				lines.push(msg.content);
				lines.push("");
				break;
			case "assistant":
				lines.push(`[ASSISTANT]`);
				lines.push(msg.content);
				lines.push("");
				break;
			case "tool_call":
				lines.push(`[TOOL: ${msg.toolName ?? "unknown"}]`);
				lines.push(msg.content);
				lines.push("");
				break;
			case "tool_result":
				lines.push(`[TOOL RESULT]`);
				lines.push(msg.content);
				lines.push("");
				break;
		}
	}

	return lines.join("\n");
}
