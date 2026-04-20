import { describe, expect, it } from "vitest";
import {
	nullToUndefined,
	rowToAgentRun,
	rowToGate,
	rowToNode,
	rowToPipelineRun,
} from "../../src/state/row-mappers.js";

describe("Row Mappers", () => {
	describe("nullToUndefined", () => {
		it("converts null to undefined", () => {
			expect(nullToUndefined(null)).toBeUndefined();
		});

		it("passes through non-null values", () => {
			expect(nullToUndefined("hello")).toBe("hello");
			expect(nullToUndefined(42)).toBe(42);
		});
	});

	describe("rowToPipelineRun", () => {
		it("maps a row with string JSON inputs (SQLite)", () => {
			const row = {
				id: "run-1",
				project_name: "proj",
				pipeline_name: "std",
				status: "running",
				current_phase: 2,
				inputs: '{"brief":"hello"}',
				version: 3,
				started_at: "2026-01-01T00:00:00Z",
				completed_at: null,
				created_at: "2026-01-01T00:00:00Z",
			};
			const run = rowToPipelineRun(row);
			expect(run.inputs).toEqual({ brief: "hello" });
			expect(run.completedAt).toBeUndefined();
			expect(run.version).toBe(3);
		});

		it("maps a row with parsed JSONB inputs (PostgreSQL)", () => {
			const row = {
				id: "run-2",
				project_name: "proj",
				pipeline_name: "std",
				status: "completed",
				current_phase: 1,
				inputs: { brief: "world" },
				version: 1,
				started_at: "2026-01-01T00:00:00Z",
				completed_at: "2026-01-02T00:00:00Z",
				created_at: "2026-01-01T00:00:00Z",
			};
			const run = rowToPipelineRun(row);
			expect(run.inputs).toEqual({ brief: "world" });
			expect(run.completedAt).toBe("2026-01-02T00:00:00Z");
		});
	});

	describe("rowToAgentRun", () => {
		const baseRow = {
			id: "ar-1",
			pipeline_run_id: "run-1",
			agent_name: "analyst",
			phase: 1,
			node_name: "local",
			status: "succeeded",
			input_artifact_ids: "[]",
			output_artifact_ids: '["art-1"]',
			token_usage: null,
			provider: null,
			model_name: null,
			cost_usd: null,
			duration_ms: null,
			error: null,
			revision_notes: null,
			retry_count: 0,
			recovery_token: null,
			last_status_at: null,
			status_message: null,
			started_at: "2026-01-01T00:00:00Z",
			completed_at: "2026-01-01T00:01:00Z",
			created_at: "2026-01-01T00:00:00Z",
		};

		it("handles string JSON arrays (SQLite)", () => {
			const run = rowToAgentRun(baseRow);
			expect(run.outputArtifactIds).toEqual(["art-1"]);
			expect(run.inputArtifactIds).toEqual([]);
		});

		it("handles parsed JSONB arrays (PostgreSQL)", () => {
			const pgRow = {
				...baseRow,
				input_artifact_ids: [],
				output_artifact_ids: ["art-1"],
				token_usage: { inputTokens: 100, outputTokens: 50 },
			};
			const run = rowToAgentRun(pgRow);
			expect(run.outputArtifactIds).toEqual(["art-1"]);
			expect(run.tokenUsage).toEqual({
				inputTokens: 100,
				outputTokens: 50,
			});
		});

		it("falls back to empty array for unexpected non-array value (covers parseJsonArray line 30)", () => {
			// Pass a number for input_artifact_ids — not null, not string, not array → return []
			const row = { ...baseRow, input_artifact_ids: 42 };
			const run = rowToAgentRun(row);
			expect(run.inputArtifactIds).toEqual([]);
		});
	});

	describe("rowToNode", () => {
		it("handles string capabilities (SQLite)", () => {
			const row = {
				name: "node-1",
				type: "local",
				capabilities: '["llm-access"]',
				max_concurrent_runs: 3,
				status: "online",
				active_runs: 1,
				last_heartbeat: null,
				updated_at: "2026-01-01T00:00:00Z",
			};
			const node = rowToNode(row);
			expect(node.capabilities).toEqual(["llm-access"]);
		});

		it("handles parsed JSONB capabilities (PostgreSQL)", () => {
			const row = {
				name: "node-1",
				type: "local",
				capabilities: ["llm-access"],
				max_concurrent_runs: null,
				status: "online",
				active_runs: 0,
				last_heartbeat: null,
				updated_at: "2026-01-01T00:00:00Z",
			};
			const node = rowToNode(row);
			expect(node.capabilities).toEqual(["llm-access"]);
			expect(node.maxConcurrentRuns).toBeUndefined();
		});
	});

	describe("rowToGate", () => {
		it("handles string artifact_version_ids (SQLite)", () => {
			const row = {
				id: "g-1",
				pipeline_run_id: "run-1",
				phase_completed: 1,
				phase_next: 2,
				status: "pending",
				reviewer: null,
				comment: null,
				revision_notes: null,
				artifact_version_ids: '["v1","v2"]',
				cross_cutting_findings: null,
				version: 1,
				decided_at: null,
				created_at: "2026-01-01T00:00:00Z",
			};
			const gate = rowToGate(row);
			expect(gate.artifactVersionIds).toEqual(["v1", "v2"]);
		});

		it("handles parsed JSONB artifact_version_ids (PostgreSQL)", () => {
			const row = {
				id: "g-1",
				pipeline_run_id: "run-1",
				phase_completed: 1,
				phase_next: 2,
				status: "approved",
				reviewer: "admin",
				comment: null,
				revision_notes: null,
				artifact_version_ids: ["v1"],
				cross_cutting_findings: { issues: [] },
				version: 2,
				decided_at: "2026-01-01T00:00:00Z",
				created_at: "2026-01-01T00:00:00Z",
			};
			const gate = rowToGate(row);
			expect(gate.artifactVersionIds).toEqual(["v1"]);
			expect(gate.crossCuttingFindings).toEqual({ issues: [] });
		});
	});
});
