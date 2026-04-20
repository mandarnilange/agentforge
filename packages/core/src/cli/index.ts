#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { createCoreApp } from "../di/app.js";

// Read version from package.json so CLI --version stays in sync with the
// published package. File layout: dist/cli/index.js → ../../package.json.
const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const pkgVersion = (JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }).version;
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerGateCommand } from "./commands/gate.js";
import { registerGetCommand } from "./commands/get-pipeline.js";
import { registerInfoCommand } from "./commands/info.js";
import { registerInitCommand } from "./commands/init.js";
import { registerListCommand } from "./commands/list.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerRunPipelineCommand } from "./commands/run-pipeline.js";
import { registerTemplatesCommand } from "./commands/templates.js";

const program = new Command();

program
	.name("agentforge-core")
	.description(
		"AgentForge — Kubernetes-style control plane for AI agent workflows. Define agents and pipelines in YAML; the framework handles execution, approval gates, artifact chaining, and state.",
	)
	.version(pkgVersion)
	.option(
		"--agentforge-dir <path>",
		"path to agent/pipeline/node definitions directory (default: .agentforge)",
	);

// Parse only the global option before booting the app so AGENTFORGE_DIR is
// set before any module reads it as a fallback.
program.parseOptions(process.argv);
const globalOpts = program.opts<{ agentforgeDir?: string }>();
if (globalOpts.agentforgeDir) {
	process.env.AGENTFORGE_DIR = globalOpts.agentforgeDir;
}

// These commands don't need the DI container — register and dispatch immediately.
registerInitCommand(program);
registerTemplatesCommand(program);
const subcommand = process.argv[2];
if (subcommand === "init" || subcommand === "templates") {
	void program.parseAsync();
} else {
	const app = await createCoreApp();

	registerListCommand(program);
	registerInfoCommand(program);
	registerExecCommand(program);

	registerDashboardCommand(program, {
		store: app.stateStore,
		pipelineController: app.pipelineController,
		gateController: app.gateController,
		definitionStore: app.definitionStore,
		config: app.appConfig,
		eventBus: app.eventBus,
		agentExecutor: app.agentExecutor,
	});
	registerLogsCommand(program, app.stateStore);
	registerRunPipelineCommand(program, app.pipelineController, app.stateStore);
	registerGetCommand(program, app.stateStore);
	registerGateCommand(program, app.stateStore, app.pipelineController);

	void program.parseAsync().then(async () => {
		await app.stateStore.close();
	});
}
