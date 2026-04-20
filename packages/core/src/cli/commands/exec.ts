/**
 * CLI exec command — run an SDLC agent from the command line.
 */

import type { Command } from "commander";
import { getAgentInfo, getAllAgentIds } from "../../agents/registry.js";
import { createAgent } from "../../agents/runner.js";
import { loadConfig } from "../../di/config.js";
import { createContainerForAgent } from "../../di/container.js";

interface ExecOptions {
	input?: string;
	output?: string;
	prompt?: string;
	model?: string;
	verbose?: boolean;
	dryRun?: boolean;
}

export function registerExecCommand(program: Command): void {
	program
		.command("exec <agent>")
		.description("Execute an SDLC agent")
		.option("-i, --input <path>", "Input file, directory, or inline text")
		.option(
			"-o, --output <dir>",
			"Output directory (overrides AGENTFORGE_OUTPUT_DIR)",
		)
		.option("-p, --prompt <text>", "Additional user prompt")
		.option(
			"-m, --model <model>",
			"LLM model to use (overrides AGENTFORGE_DEFAULT_MODEL)",
		)
		.option("-v, --verbose", "Enable verbose logging")
		.option(
			"--dry-run",
			"Show what would be sent to the LLM without calling it",
		)
		.action(async (agentId: string, opts: ExecOptions) => {
			await executeAgent(agentId, opts);
		});
}

async function executeAgent(agentId: string, opts: ExecOptions): Promise<void> {
	// Validate agent exists
	const agentInfo = getAgentInfo(agentId);
	if (!agentInfo) {
		const validIds = getAllAgentIds().join(", ");
		console.error(`Unknown agent: "${agentId}". Available agents: ${validIds}`);
		process.exitCode = 1;
		return;
	}

	// Build config overrides from CLI flags
	const configOverrides: Record<string, unknown> = {};
	if (opts.model) {
		configOverrides.llm = { model: opts.model };
	}
	if (opts.output) {
		configOverrides.outputDir = opts.output;
	}
	if (opts.verbose) {
		configOverrides.logLevel = "debug";
	}

	// Dry run: show config without calling the LLM (no API key needed)
	if (opts.dryRun) {
		const provider = "anthropic";
		const model =
			opts.model ??
			process.env.AGENTFORGE_DEFAULT_MODEL ??
			"claude-sonnet-4-20250514";
		const outputDir =
			opts.output ?? process.env.AGENTFORGE_OUTPUT_DIR ?? "./output";

		console.log("--- DRY RUN ---");
		console.log(`Agent:      ${agentInfo.displayName} (${agentId})`);
		console.log(`Executor:   ${agentInfo.executor}`);
		console.log(`Model:      ${provider}/${model}`);
		console.log(`Output dir: ${outputDir}`);
		console.log(`Inputs:     ${agentInfo.inputs.join(", ")}`);
		console.log(`Outputs:    ${agentInfo.outputs.join(", ")}`);
		if (opts.input) console.log(`Input file: ${opts.input}`);
		if (opts.prompt) console.log(`Prompt:     ${opts.prompt}`);
		if (agentInfo.tools.length > 0)
			console.log(`Tools:      ${agentInfo.tools.join(", ")}`);
		console.log("---");
		console.log("No LLM call made.");
		return;
	}

	// Load config (requires API key for real runs)
	let config: ReturnType<typeof loadConfig>;
	try {
		config = loadConfig(configOverrides as Parameters<typeof loadConfig>[0]);
	} catch (err) {
		const { default: chalk } = await import("chalk");
		const code = (err as Error & { code?: string }).code;
		if (code === "MISSING_API_KEY") {
			console.error(
				chalk.red("Configuration error: missing ANTHROPIC_API_KEY"),
			);
			console.error("");
			console.error(
				err instanceof Error ? err.message : "Missing ANTHROPIC_API_KEY",
			);
		} else {
			console.error(chalk.red("Failed to load configuration"));
			console.error(err instanceof Error ? err.message : String(err));
		}
		process.exitCode = 1;
		return;
	}

	// Dynamic imports for ora/chalk so tests don't need them
	const [{ default: ora }, { default: chalk }] = await Promise.all([
		import("ora"),
		import("chalk"),
	]);

	const startTime = Date.now();
	const spinner = ora(`Running ${agentInfo.displayName}...`).start();

	const container = createContainerForAgent(agentInfo.executor, config, {
		onProgress: (event) => {
			const elapsed = Math.round((Date.now() - startTime) / 1000);
			if (event.tokensOut) {
				spinner.text = `Running ${agentInfo.displayName}... ${elapsed}s elapsed, ~${event.tokensOut * 20} tokens generated`;
			}
		},
	});

	try {
		const runner = createAgent(agentId, container);
		const result = await runner.run({
			input: opts.input,
			prompt: opts.prompt,
			outputDir: opts.output,
		});

		spinner.succeed(`${agentInfo.displayName} completed`);

		// Print summary
		console.log("");
		console.log(chalk.bold("Summary"));
		console.log(`  Artifacts produced: ${result.artifacts.length}`);
		for (const a of result.artifacts) {
			console.log(`    - ${a.path} (${a.type})`);
		}
		console.log(
			`  Token usage: ${result.tokenUsage.inputTokens} in / ${result.tokenUsage.outputTokens} out`,
		);
		console.log(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
		console.log(`  Output: ${opts.output ?? config.outputDir}`);
		console.log("");
		for (const file of result.savedFiles) {
			console.log(chalk.green(`  Saved: ${file}`));
		}
	} catch (err) {
		spinner.fail(`${agentInfo.displayName} failed`);
		console.error(
			err instanceof Error
				? err.message
				: "Unknown error during agent execution",
		);
		process.exitCode = 1;
	}
}
