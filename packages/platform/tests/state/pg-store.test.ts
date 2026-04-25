/**
 * Tests for PostgresStateStore using a mocked pg.Pool.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so these are available inside the vi.mock factory
const { mockQuery, mockEnd } = vi.hoisted(() => ({
	mockQuery: vi.fn(),
	mockEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("pg", () => {
	class MockPool {
		query = mockQuery;
		end = mockEnd;
		// applyPgMigrations() takes a dedicated client so the advisory lock
		// shares a session with the migration queries. Route the client's
		// query through the same mock so existing assertions still see calls.
		async connect() {
			return {
				query: mockQuery,
				release: () => {},
			};
		}
	}
	return { default: { Pool: MockPool } };
});

import { PostgresStateStore } from "../../src/state/pg-store.js";

// Row data factories (must match rowTo* mapper input shapes)
function pipelineRow(overrides = {}) {
	return {
		id: "pipe-1",
		session_name: "quiet-river",
		project_name: "my-project",
		pipeline_name: "standard-sdlc",
		status: "running",
		current_phase: 1,
		inputs: null,
		version: 1,
		started_at: "2024-01-01T00:00:00Z",
		completed_at: null,
		created_at: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function agentRunRow(overrides = {}) {
	return {
		id: "run-1",
		pipeline_run_id: "pipe-1",
		agent_name: "analyst",
		phase: 1,
		node_name: "local",
		status: "running",
		input_artifact_ids: "[]",
		output_artifact_ids: "[]",
		token_usage: null,
		provider: "anthropic",
		model_name: "claude-sonnet",
		cost_usd: null,
		duration_ms: null,
		error: null,
		revision_notes: null,
		retry_count: 0,
		recovery_token: null,
		started_at: "2024-01-01T00:00:00Z",
		completed_at: null,
		created_at: "2024-01-01T00:00:00Z",
		last_status_at: null,
		status_message: null,
		...overrides,
	};
}

function gateRow(overrides = {}) {
	return {
		id: "gate-1",
		pipeline_run_id: "pipe-1",
		phase_completed: 1,
		phase_next: 2,
		status: "pending",
		reviewer: null,
		comment: null,
		revision_notes: null,
		artifact_version_ids: "[]",
		cross_cutting_findings: null,
		decided_at: null,
		created_at: "2024-01-01T00:00:00Z",
		version: 1,
		...overrides,
	};
}

function nodeRow(overrides = {}) {
	return {
		name: "local",
		type: "local",
		capabilities: '["llm-access"]',
		max_concurrent_runs: 2,
		status: "online",
		active_runs: 0,
		last_heartbeat: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

function auditRow(overrides = {}) {
	return {
		id: "audit-1",
		pipeline_run_id: "pipe-1",
		actor: "system",
		action: "gate.approved",
		resource_type: "gate",
		resource_id: "gate-1",
		metadata: null,
		created_at: "2024-01-01T00:00:00Z",
		...overrides,
	};
}

describe("PostgresStateStore", () => {
	let store: PostgresStateStore;

	beforeEach(() => {
		vi.clearAllMocks();
		store = new PostgresStateStore("postgresql://localhost/test");
	});

	describe("initialize()", () => {
		it("runs migrations that create the schema", async () => {
			// initialize() now: (1) create schema_migrations table,
			// (2) select applied versions, (3) exec each pending migration,
			// (4) insert into schema_migrations per applied migration.
			mockQuery.mockResolvedValue({ rows: [] });
			await store.initialize();
			const sqls = mockQuery.mock.calls
				.map((c) => c[0])
				.filter((s): s is string => typeof s === "string");
			expect(sqls.some((s) => s.includes("CREATE TABLE"))).toBe(true);
			expect(sqls.some((s) => s.includes("schema_migrations"))).toBe(true);
		});
	});

	describe("createPipelineRun()", () => {
		it("inserts a pipeline run and returns it", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.createPipelineRun({
				projectName: "my-project",
				pipelineName: "standard-sdlc",
				status: "running",
				currentPhase: 1,
				startedAt: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO pipeline_runs"),
				expect.any(Array),
			);
			expect(result.projectName).toBe("my-project");
			expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		});
	});

	describe("getPipelineRun()", () => {
		it("returns the pipeline when found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [pipelineRow()] });
			const result = await store.getPipelineRun("pipe-1");
			expect(result).not.toBeNull();
			expect(result?.id).toBe("pipe-1");
		});

		it("returns null when not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.getPipelineRun("missing");
			expect(result).toBeNull();
		});
	});

	describe("listPipelineRuns()", () => {
		it("returns all pipeline runs", async () => {
			mockQuery.mockResolvedValueOnce({
				rows: [pipelineRow(), pipelineRow({ id: "pipe-2" })],
			});
			const result = await store.listPipelineRuns();
			expect(result).toHaveLength(2);
		});
	});

	describe("updatePipelineRun()", () => {
		it("updates status and currentPhase", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updatePipelineRun("pipe-1", {
				status: "completed",
				currentPhase: 6,
				completedAt: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE pipeline_runs"),
				expect.any(Array),
			);
		});

		it("is a no-op when updates is empty", async () => {
			await store.updatePipelineRun("pipe-1", {});
			expect(mockQuery).not.toHaveBeenCalled();
		});
	});

	describe("createAgentRun()", () => {
		it("inserts an agent run and returns it", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.createAgentRun({
				pipelineRunId: "pipe-1",
				agentName: "analyst",
				phase: 1,
				nodeName: "local",
				status: "running",
				inputArtifactIds: [],
				outputArtifactIds: [],
				startedAt: new Date().toISOString(),
			});
			expect(result.agentName).toBe("analyst");
			expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		});
	});

	describe("getAgentRun()", () => {
		it("returns the run when found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [agentRunRow()] });
			const result = await store.getAgentRun("run-1");
			expect(result).not.toBeNull();
			expect(result?.id).toBe("run-1");
		});

		it("returns null when not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.getAgentRun("missing")).toBeNull();
		});
	});

	describe("listAgentRuns()", () => {
		it("returns runs for a pipeline", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [agentRunRow()] });
			const result = await store.listAgentRuns("pipe-1");
			expect(result).toHaveLength(1);
		});
	});

	describe("updateAgentRun()", () => {
		it("updates multiple agent run fields", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateAgentRun("run-1", {
				status: "succeeded",
				completedAt: new Date().toISOString(),
				costUsd: 0.01,
				tokenUsage: { inputTokens: 1000, outputTokens: 500 },
				outputArtifactIds: ["/out/frd.json"],
				provider: "anthropic",
				modelName: "claude-sonnet",
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE agent_runs"),
				expect.any(Array),
			);
		});

		it("is a no-op when updates is empty", async () => {
			await store.updateAgentRun("run-1", {});
			expect(mockQuery).not.toHaveBeenCalled();
		});

		it("handles lastStatusAt and statusMessage fields", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateAgentRun("run-1", {
				lastStatusAt: new Date().toISOString(),
				statusMessage: "processing",
			});
			expect(mockQuery).toHaveBeenCalled();
		});
	});

	describe("upsertNode()", () => {
		it("upserts a node record", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.upsertNode({
				name: "local",
				type: "local",
				capabilities: ["llm-access"],
				maxConcurrentRuns: 2,
				status: "online",
				activeRuns: 0,
				lastHeartbeat: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO nodes"),
				expect.any(Array),
			);
		});
	});

	describe("getNode()", () => {
		it("returns node when found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] });
			const result = await store.getNode("local");
			expect(result).not.toBeNull();
			expect(result?.name).toBe("local");
		});

		it("returns null when not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.getNode("missing")).toBeNull();
		});
	});

	describe("listNodes()", () => {
		it("returns all nodes", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] });
			const result = await store.listNodes();
			expect(result).toHaveLength(1);
		});
	});

	describe("createGate()", () => {
		it("inserts a gate and returns it", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.createGate({
				pipelineRunId: "pipe-1",
				phaseCompleted: 1,
				phaseNext: 2,
				status: "pending",
				artifactVersionIds: [],
			});
			expect(result.pipelineRunId).toBe("pipe-1");
			expect(result.status).toBe("pending");
		});
	});

	describe("getGate()", () => {
		it("returns the gate when found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [gateRow()] });
			const result = await store.getGate("gate-1");
			expect(result).not.toBeNull();
			expect(result?.id).toBe("gate-1");
		});

		it("returns null when not found", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.getGate("missing")).toBeNull();
		});
	});

	describe("listGates()", () => {
		it("returns gates for a pipeline", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [gateRow()] });
			const result = await store.listGates("pipe-1");
			expect(result).toHaveLength(1);
		});
	});

	describe("updateGate()", () => {
		it("updates gate fields", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateGate("gate-1", {
				status: "approved",
				reviewer: "alice",
				comment: "LGTM",
				decidedAt: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE gates"),
				expect.any(Array),
			);
		});

		it("updates crossCuttingFindings", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateGate("gate-1", {
				crossCuttingFindings: [
					{ severity: "high", description: "SQL injection" },
				],
			});
			expect(mockQuery).toHaveBeenCalled();
		});

		it("updates revisionNotes", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateGate("gate-1", {
				revisionNotes: "Please fix X",
			});
			expect(mockQuery).toHaveBeenCalled();
		});

		it("is a no-op when updates is empty", async () => {
			await store.updateGate("gate-1", {});
			expect(mockQuery).not.toHaveBeenCalled();
		});
	});

	describe("getPendingGate()", () => {
		it("returns the pending gate for a pipeline", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [gateRow()] });
			const result = await store.getPendingGate("pipe-1");
			expect(result).not.toBeNull();
			expect(result?.status).toBe("pending");
		});

		it("returns null when no pending gate", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.getPendingGate("pipe-1")).toBeNull();
		});
	});

	describe("writeAuditLog()", () => {
		it("inserts an audit log entry", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.writeAuditLog({
				pipelineRunId: "pipe-1",
				actor: "system",
				action: "gate.approved",
				resourceType: "gate",
				resourceId: "gate-1",
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO audit_log"),
				expect.any(Array),
			);
		});
	});

	describe("listAuditLog()", () => {
		it("returns all audit log when no pipelineRunId", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [auditRow()] });
			const result = await store.listAuditLog();
			expect(result).toHaveLength(1);
		});

		it("filters by pipelineRunId when provided", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [auditRow()] });
			const result = await store.listAuditLog("pipe-1");
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("WHERE pipeline_run_id"),
				expect.any(Array),
			);
			expect(result).toHaveLength(1);
		});
	});

	describe("getConversationLog()", () => {
		it("returns empty array when no log", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			expect(await store.getConversationLog("run-1")).toEqual([]);
		});

		it("parses JSON string conversation log", async () => {
			const log = [{ role: "user", content: "Hello", timestamp: Date.now() }];
			mockQuery.mockResolvedValueOnce({
				rows: [{ log_json: JSON.stringify(log) }],
			});
			const result = await store.getConversationLog("run-1");
			expect(result).toHaveLength(1);
			expect(result[0].role).toBe("user");
		});

		it("handles already-parsed JSONB object", async () => {
			const log = [{ role: "assistant", content: "Hi", timestamp: Date.now() }];
			mockQuery.mockResolvedValueOnce({
				rows: [{ log_json: log }],
			});
			const result = await store.getConversationLog("run-1");
			expect(result).toHaveLength(1);
		});
	});

	describe("updateAgentRun() — additional fields", () => {
		it("updates durationMs field", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateAgentRun("run-1", { durationMs: 5000 });
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE agent_runs"),
				expect.arrayContaining([5000]),
			);
		});

		it("updates startedAt field", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const startedAt = new Date().toISOString();
			await store.updateAgentRun("run-1", { startedAt });
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE agent_runs"),
				expect.arrayContaining([startedAt]),
			);
		});

		it("updates error field", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.updateAgentRun("run-1", { error: "API rate limited" });
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("UPDATE agent_runs"),
				expect.arrayContaining(["API rate limited"]),
			);
		});
	});

	describe("saveConversationLog()", () => {
		it("upserts conversation log for a run", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const log = [
				{ role: "user" as const, content: "Hello", timestamp: Date.now() },
			];
			await store.saveConversationLog("run-1", log);
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("conversation_logs"),
				expect.arrayContaining(["run-1"]),
			);
		});
	});

	describe("writeExecutionLog()", () => {
		it("inserts an execution log entry", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.writeExecutionLog({
				agentRunId: "run-1",
				level: "info",
				message: "Agent started",
				timestamp: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalledWith(
				expect.stringContaining("execution_logs"),
				expect.any(Array),
			);
		});

		it("includes metadata when provided", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			await store.writeExecutionLog({
				agentRunId: "run-1",
				level: "debug",
				message: "Processing",
				metadata: { key: "value" },
				timestamp: new Date().toISOString(),
			});
			expect(mockQuery).toHaveBeenCalled();
		});
	});

	describe("listExecutionLogs()", () => {
		it("returns logs for an agent run", async () => {
			const logRow = {
				id: "log-1",
				agent_run_id: "run-1",
				level: "info",
				message: "Started",
				metadata: null,
				timestamp: "2024-01-01T00:00:00Z",
			};
			mockQuery.mockResolvedValueOnce({ rows: [logRow] });
			const result = await store.listExecutionLogs("run-1");
			expect(result).toHaveLength(1);
			expect(result[0].agentRunId).toBe("run-1");
		});

		it("returns empty list when no logs", async () => {
			mockQuery.mockResolvedValueOnce({ rows: [] });
			const result = await store.listExecutionLogs("run-empty");
			expect(result).toHaveLength(0);
		});
	});

	describe("close()", () => {
		it("ends the pool", async () => {
			await store.close();
			expect(mockEnd).toHaveBeenCalled();
		});
	});
});
