import { describe, expect, it, vi } from "vitest";
import type { ArtifactData } from "../../src/domain/models/artifact.model.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
	StatusUpdateType,
} from "../../src/domain/ports/agent-executor.port.js";

describe("domain/ports/agent-executor", () => {
	describe("AgentJob", () => {
		it("should express a complete job with all required fields", () => {
			const job: AgentJob = {
				runId: "run-001",
				agentId: "developer",
				agentDefinition: {
					metadata: { name: "developer" },
				} as AgentJob["agentDefinition"],
				inputs: [
					{ type: "spec", path: "spec.json", content: "{}" },
				] as readonly ArtifactData[],
				workdir: "/tmp/workspace",
				outputDir: "/tmp/output",
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4",
					maxTokens: 64000,
				},
			};

			expect(job.runId).toBe("run-001");
			expect(job.agentId).toBe("developer");
			expect(job.inputs).toHaveLength(1);
			expect(job.model.provider).toBe("anthropic");
			expect(job.revisionNotes).toBeUndefined();
		});

		it("should support optional revisionNotes", () => {
			const job: AgentJob = {
				runId: "run-002",
				agentId: "developer",
				agentDefinition: {} as AgentJob["agentDefinition"],
				inputs: [],
				workdir: "/tmp/workspace",
				outputDir: "/tmp/output",
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4",
					maxTokens: 64000,
				},
				revisionNotes: "Add rate limiting to the API",
			};

			expect(job.revisionNotes).toBe("Add rate limiting to the API");
		});
	});

	describe("AgentJobResult", () => {
		it("should express a succeeded result with all metrics", () => {
			const result: AgentJobResult = {
				status: "succeeded",
				artifacts: [{ type: "code", path: "api.ts", content: "export {}" }],
				savedFiles: ["src/routes/users.ts"],
				tokenUsage: { inputTokens: 8420, outputTokens: 12150 },
				costUsd: 0.207,
				durationMs: 23456,
				conversationLog: [
					{ role: "user", content: "Generate API", timestamp: Date.now() },
				],
			};

			expect(result.status).toBe("succeeded");
			expect(result.artifacts).toHaveLength(1);
			expect(result.savedFiles).toHaveLength(1);
			expect(result.costUsd).toBe(0.207);
			expect(result.error).toBeUndefined();
		});

		it("should express a failed result with error", () => {
			const result: AgentJobResult = {
				status: "failed",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 100, outputTokens: 0 },
				costUsd: 0.0003,
				durationMs: 500,
				conversationLog: [],
				error: "LLM rate limit exceeded",
			};

			expect(result.status).toBe("failed");
			expect(result.error).toBe("LLM rate limit exceeded");
		});
	});

	describe("StatusUpdate", () => {
		it("should support all status update types", () => {
			const types: StatusUpdateType[] = [
				"started",
				"progress",
				"step_started",
				"step_completed",
				"completed",
				"failed",
			];
			expect(types).toHaveLength(6);

			const update: StatusUpdate = {
				type: "progress",
				runId: "run-001",
				message: "Generating architecture...",
				timestamp: Date.now(),
			};
			expect(update.type).toBe("progress");
			expect(update.runId).toBe("run-001");
		});

		it("should support step-level status with step name", () => {
			const update: StatusUpdate = {
				type: "step_started",
				runId: "run-001",
				step: "lint",
				timestamp: Date.now(),
			};
			expect(update.step).toBe("lint");
		});

		it("should support tokensGenerated for progress tracking", () => {
			const update: StatusUpdate = {
				type: "progress",
				runId: "run-001",
				tokensGenerated: 5000,
				timestamp: Date.now(),
			};
			expect(update.tokensGenerated).toBe(5000);
		});
	});

	describe("IAgentExecutor", () => {
		it("should be implementable with execute() and cancel()", async () => {
			const executor: IAgentExecutor = {
				execute: async (_job, _onStatus?) => ({
					status: "succeeded",
					artifacts: [],
					savedFiles: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					costUsd: 0,
					durationMs: 100,
					conversationLog: [],
				}),
				cancel: async () => {},
			};

			const result = await executor.execute({
				runId: "run-001",
				agentId: "test",
				agentDefinition: {} as AgentJob["agentDefinition"],
				inputs: [],
				workdir: "/tmp",
				outputDir: "/tmp/out",
				model: {
					provider: "anthropic",
					name: "claude-sonnet-4",
					maxTokens: 4096,
				},
			});

			expect(result.status).toBe("succeeded");
		});

		it("should stream status updates via onStatus callback", async () => {
			const updates: StatusUpdate[] = [];

			const executor: IAgentExecutor = {
				execute: async (_job, onStatus?) => {
					onStatus?.({
						type: "started",
						runId: "run-001",
						timestamp: Date.now(),
					});
					onStatus?.({
						type: "progress",
						runId: "run-001",
						message: "Working...",
						timestamp: Date.now(),
					});
					onStatus?.({
						type: "completed",
						runId: "run-001",
						timestamp: Date.now(),
					});
					return {
						status: "succeeded",
						artifacts: [],
						savedFiles: [],
						tokenUsage: { inputTokens: 100, outputTokens: 200 },
						costUsd: 0.004,
						durationMs: 1500,
						conversationLog: [],
					};
				},
				cancel: async () => {},
			};

			await executor.execute(
				{
					runId: "run-001",
					agentId: "test",
					agentDefinition: {} as AgentJob["agentDefinition"],
					inputs: [],
					workdir: "/tmp",
					outputDir: "/tmp/out",
					model: {
						provider: "anthropic",
						name: "claude-sonnet-4",
						maxTokens: 4096,
					},
				},
				(update) => updates.push(update),
			);

			expect(updates).toHaveLength(3);
			expect(updates[0].type).toBe("started");
			expect(updates[1].type).toBe("progress");
			expect(updates[1].message).toBe("Working...");
			expect(updates[2].type).toBe("completed");
		});

		it("requires cancel() to be implemented", async () => {
			const cancelSpy = vi.fn().mockResolvedValue(undefined);
			const executor: IAgentExecutor = {
				execute: async () => ({
					status: "succeeded",
					artifacts: [],
					savedFiles: [],
					tokenUsage: { inputTokens: 0, outputTokens: 0 },
					costUsd: 0,
					durationMs: 0,
					conversationLog: [],
				}),
				cancel: cancelSpy,
			};

			await executor.cancel("run-001");
			expect(cancelSpy).toHaveBeenCalledWith("run-001");
		});

		it("supports conversation_entry status updates", async () => {
			const updates: StatusUpdate[] = [];
			const executor: IAgentExecutor = {
				execute: async (_job, onStatus?) => {
					onStatus?.({
						type: "conversation_entry",
						runId: "run-001",
						conversationEntry: {
							role: "assistant",
							content: "partial output",
							timestamp: Date.now(),
						},
						timestamp: Date.now(),
					});
					return {
						status: "succeeded",
						artifacts: [],
						savedFiles: [],
						tokenUsage: { inputTokens: 0, outputTokens: 0 },
						costUsd: 0,
						durationMs: 0,
						conversationLog: [],
					};
				},
				cancel: async () => {},
			};

			await executor.execute(
				{
					runId: "run-001",
					agentId: "test",
					agentDefinition: {} as AgentJob["agentDefinition"],
					inputs: [],
					workdir: "/tmp",
					outputDir: "/tmp/out",
					model: {
						provider: "anthropic",
						name: "claude-sonnet-4",
						maxTokens: 4096,
					},
				},
				(update) => updates.push(update),
			);

			expect(updates).toHaveLength(1);
			expect(updates[0].type).toBe("conversation_entry");
			expect(updates[0].conversationEntry?.content).toBe("partial output");
		});
	});
});
