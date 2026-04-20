import { existsSync, rmSync } from "node:fs";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerGateCommand } from "../../src/cli/commands/gate.js";
import { registerGetCommand } from "../../src/cli/commands/get-pipeline.js";
import { registerRunPipelineCommand } from "../../src/cli/commands/run-pipeline.js";
import { GateController } from "../../src/control-plane/gate-controller.js";
import { PipelineController } from "../../src/control-plane/pipeline-controller.js";
import { LocalAgentScheduler } from "../../src/control-plane/scheduler.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-agent-cli-test.db";

function makeTestDeps() {
	const store = new SqliteStateStore(TEST_DB);
	const gateCtrl = new GateController(store);
	const scheduler = new LocalAgentScheduler();
	const controller = new PipelineController(store, gateCtrl, scheduler);
	return { store, gateCtrl, scheduler, controller };
}

describe("run-pipeline CLI command", () => {
	let store: SqliteStateStore;
	let controller: PipelineController;

	beforeEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		const deps = makeTestDeps();
		store = deps.store;
		controller = deps.controller;
	});

	afterEach(() => {
		store.close();
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("registers the run command without error", () => {
		const program = new Command();
		expect(() => registerRunPipelineCommand(program, controller)).not.toThrow();
		expect(program.commands.some((c) => c.name() === "run")).toBe(true);
	});

	it("registers the get command without error", () => {
		const program = new Command();
		expect(() => registerGetCommand(program, store)).not.toThrow();
		expect(program.commands.some((c) => c.name() === "get")).toBe(true);
	});

	it("registers the gate command without error", () => {
		const program = new Command();
		expect(() => registerGateCommand(program, store, controller)).not.toThrow();
		expect(program.commands.some((c) => c.name() === "gate")).toBe(true);
	});
});
