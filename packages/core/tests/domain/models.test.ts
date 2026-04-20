import { describe, expect, it } from "vitest";
import type {
	AgentDefinition,
	AgentRunStatus,
} from "../../src/domain/models/agent.model.js";
import type {
	ArtifactData,
	ArtifactMetadata,
	ArtifactQuery,
	ArtifactType,
	SavedArtifact,
} from "../../src/domain/models/artifact.model.js";
import type { AgentEvent } from "../../src/domain/models/events.model.js";

// Also verify barrel re-exports
import type {
	AgentDefinition as ReExportedAgentDefinition,
	AgentEvent as ReExportedAgentEvent,
	ArtifactData as ReExportedArtifactData,
} from "../../src/domain/models/index.js";

describe("domain/models", () => {
	describe("ArtifactData", () => {
		it("should be constructible with required fields", () => {
			const artifact: ArtifactData = {
				type: "code",
				path: "src/index.ts",
				content: "console.log('hello');",
			};
			expect(artifact.type).toBe("code");
			expect(artifact.path).toBe("src/index.ts");
			expect(artifact.content).toBe("console.log('hello');");
		});

		it("should accept all artifact types", () => {
			const types: ArtifactType[] = [
				"code",
				"test",
				"spec",
				"config",
				"documentation",
				"diagram",
				"report",
				"prompt",
				"other",
			];
			for (const type of types) {
				const a: ArtifactData = { type, path: "x", content: "y" };
				expect(a.type).toBe(type);
			}
		});

		it("should allow optional metadata", () => {
			const artifact: ArtifactData = {
				type: "code",
				path: "src/index.ts",
				content: "code",
				metadata: { language: "typescript" },
			};
			expect(artifact.metadata).toEqual({ language: "typescript" });
		});
	});

	describe("ArtifactMetadata", () => {
		it("should hold file metadata", () => {
			const meta: ArtifactMetadata = {
				path: "src/index.ts",
				type: "code",
				size: 1024,
				createdAt: new Date().toISOString(),
			};
			expect(meta.path).toBeDefined();
			expect(meta.size).toBe(1024);
		});
	});

	describe("SavedArtifact", () => {
		it("should extend ArtifactMetadata with absolute path", () => {
			const saved: SavedArtifact = {
				path: "src/index.ts",
				type: "code",
				size: 1024,
				createdAt: new Date().toISOString(),
				absolutePath: "/project/output/src/index.ts",
			};
			expect(saved.absolutePath).toContain("/project");
		});
	});

	describe("ArtifactQuery", () => {
		it("should allow filtering by type and path pattern", () => {
			const query: ArtifactQuery = {
				type: "code",
				pathPattern: "src/**/*.ts",
			};
			expect(query.type).toBe("code");
			expect(query.pathPattern).toBe("src/**/*.ts");
		});

		it("should allow empty query", () => {
			const query: ArtifactQuery = {};
			expect(query).toBeDefined();
		});
	});

	describe("AgentDefinition", () => {
		it("should define an agent with required fields", () => {
			const agent: AgentDefinition = {
				id: "spec-writer",
				name: "Spec Writer",
				description: "Writes specifications",
				phase: "design",
				inputArtifactTypes: ["spec"],
				outputArtifactTypes: ["spec", "documentation"],
			};
			expect(agent.id).toBe("spec-writer");
			expect(agent.phase).toBe("design");
		});

		it("should allow optional tools and model config", () => {
			const agent: AgentDefinition = {
				id: "coder",
				name: "Coder",
				description: "Writes code",
				phase: "implementation",
				inputArtifactTypes: ["spec"],
				outputArtifactTypes: ["code", "test"],
				tools: ["file_write", "file_read"],
				model: {
					provider: "anthropic",
					name: "claude-sonnet",
					maxTokens: 8192,
				},
			};
			expect(agent.tools).toHaveLength(2);
			expect(agent.model?.provider).toBe("anthropic");
		});
	});

	describe("AgentRunStatus", () => {
		it("should represent running state", () => {
			const status: AgentRunStatus = {
				agentId: "coder",
				status: "running",
				startedAt: new Date().toISOString(),
			};
			expect(status.status).toBe("running");
		});

		it("should represent completed state with result", () => {
			const status: AgentRunStatus = {
				agentId: "coder",
				status: "completed",
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				artifactsProduced: 3,
			};
			expect(status.status).toBe("completed");
			expect(status.artifactsProduced).toBe(3);
		});

		it("should represent failed state with error", () => {
			const status: AgentRunStatus = {
				agentId: "coder",
				status: "failed",
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				error: "Out of tokens",
			};
			expect(status.status).toBe("failed");
			expect(status.error).toBe("Out of tokens");
		});
	});

	describe("AgentEvent (discriminated union)", () => {
		it("should create a thinking event", () => {
			const event: AgentEvent = {
				kind: "thinking",
				timestamp: Date.now(),
				content: "Analyzing requirements...",
			};
			expect(event.kind).toBe("thinking");
		});

		it("should create a tool_use event", () => {
			const event: AgentEvent = {
				kind: "tool_use",
				timestamp: Date.now(),
				toolName: "file_write",
				input: { path: "src/index.ts", content: "code" },
			};
			expect(event.kind).toBe("tool_use");
			if (event.kind === "tool_use") {
				expect(event.toolName).toBe("file_write");
			}
		});

		it("should create a tool_result event", () => {
			const event: AgentEvent = {
				kind: "tool_result",
				timestamp: Date.now(),
				toolName: "file_write",
				output: "File written successfully",
				isError: false,
			};
			expect(event.kind).toBe("tool_result");
		});

		it("should create an artifact_produced event", () => {
			const event: AgentEvent = {
				kind: "artifact_produced",
				timestamp: Date.now(),
				artifact: { type: "code", path: "src/index.ts", content: "code" },
			};
			expect(event.kind).toBe("artifact_produced");
		});

		it("should create an error event", () => {
			const event: AgentEvent = {
				kind: "error",
				timestamp: Date.now(),
				message: "Token limit exceeded",
				code: "TOKEN_LIMIT",
			};
			expect(event.kind).toBe("error");
		});

		it("should create step_started and step_completed events", () => {
			const started: AgentEvent = {
				kind: "step_started",
				timestamp: Date.now(),
				stepName: "code_generation",
			};
			const completed: AgentEvent = {
				kind: "step_completed",
				timestamp: Date.now(),
				stepName: "code_generation",
				durationMs: 5000,
			};
			expect(started.kind).toBe("step_started");
			expect(completed.kind).toBe("step_completed");
		});

		it("should narrow types via discriminant", () => {
			const event: AgentEvent = {
				kind: "tool_use",
				timestamp: Date.now(),
				toolName: "file_read",
				input: { path: "README.md" },
			};

			// Type narrowing test
			if (event.kind === "tool_use") {
				expect(event.toolName).toBe("file_read");
				expect(event.input).toBeDefined();
			}
		});
	});

	describe("barrel re-exports", () => {
		it("should re-export model types from index", () => {
			// These are type-level checks; if they compile, the re-exports work
			const artifact: ReExportedArtifactData = {
				type: "code",
				path: "x",
				content: "y",
			};
			const agent: ReExportedAgentDefinition = {
				id: "a",
				name: "A",
				description: "d",
				phase: "design",
				inputArtifactTypes: [],
				outputArtifactTypes: [],
			};
			const event: ReExportedAgentEvent = {
				kind: "thinking",
				timestamp: Date.now(),
				content: "thinking",
			};
			expect(artifact).toBeDefined();
			expect(agent).toBeDefined();
			expect(event).toBeDefined();
		});
	});
});
