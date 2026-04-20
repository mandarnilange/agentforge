import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-pipeline-inputs-test.db";

describe("Pipeline inputs persistence (P18-T4)", () => {
	let store: SqliteStateStore;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		store = new SqliteStateStore(TEST_DB);
	});

	afterEach(async () => {
		await store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("creates a pipeline run with inputs and retrieves them", async () => {
		const inputs = {
			brief: "Build a SaaS invoicing platform",
			constraints: "Must use PostgreSQL",
		};

		const run = await store.createPipelineRun({
			projectName: "my-project",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
			inputs,
		});

		expect(run.inputs).toEqual(inputs);

		const fetched = await store.getPipelineRun(run.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.inputs).toEqual(inputs);
	});

	it("creates a pipeline run without inputs (backward compatible)", async () => {
		const run = await store.createPipelineRun({
			projectName: "no-inputs-project",
			pipelineName: "standard-sdlc",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});

		expect(run.inputs).toBeUndefined();

		const fetched = await store.getPipelineRun(run.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.inputs).toBeUndefined();
	});

	it("lists pipeline runs with inputs", async () => {
		await store.createPipelineRun({
			projectName: "p1",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
			inputs: { brief: "First project" },
		});
		await store.createPipelineRun({
			projectName: "p2",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
		});

		const runs = await store.listPipelineRuns();
		expect(runs).toHaveLength(2);

		const withInputs = runs.find((r) => r.projectName === "p1");
		expect(withInputs?.inputs).toEqual({ brief: "First project" });

		const withoutInputs = runs.find((r) => r.projectName === "p2");
		expect(withoutInputs?.inputs).toBeUndefined();
	});

	it("handles empty inputs object", async () => {
		const run = await store.createPipelineRun({
			projectName: "empty-inputs",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
			inputs: {},
		});

		const fetched = await store.getPipelineRun(run.id);
		expect(fetched?.inputs).toEqual({});
	});

	it("handles inputs with special characters", async () => {
		const inputs = {
			brief: 'Build a "todo" app with <html> & more',
			file: "path/to/brief.md",
		};

		const run = await store.createPipelineRun({
			projectName: "special-chars",
			pipelineName: "std",
			status: "running",
			currentPhase: 1,
			startedAt: new Date().toISOString(),
			inputs,
		});

		const fetched = await store.getPipelineRun(run.id);
		expect(fetched?.inputs).toEqual(inputs);
	});
});
