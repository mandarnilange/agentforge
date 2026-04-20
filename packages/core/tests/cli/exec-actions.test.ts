/**
 * Tests for the exec CLI command action callbacks.
 * Tests the dry-run path and error paths.
 */
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerExecCommand } from "../../src/cli/commands/exec.js";

async function runExecCommand(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	const logs: string[] = [];
	const errors: string[] = [];
	const origLog = console.log;
	const origError = console.error;
	console.log = (...a: unknown[]) => logs.push(a.join(" "));
	console.error = (...a: unknown[]) => errors.push(a.join(" "));

	const program = new Command();
	program.exitOverride();
	registerExecCommand(program);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// ignore commander exit
	} finally {
		console.log = origLog;
		console.error = origError;
	}

	return { stdout: logs.join("\n"), stderr: errors.join("\n") };
}

describe("exec command actions", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	describe("--dry-run flag", () => {
		it("shows agent info without calling LLM", async () => {
			const { stdout } = await runExecCommand(["exec", "analyst", "--dry-run"]);
			expect(stdout).toContain("DRY RUN");
			expect(stdout).toContain("analyst");
			expect(stdout).toContain("No LLM call made");
		});

		it("shows executor type in dry-run output", async () => {
			const { stdout } = await runExecCommand(["exec", "analyst", "--dry-run"]);
			expect(stdout).toContain("pi-ai");
		});

		it("shows model from env in dry-run output", async () => {
			process.env.AGENTFORGE_DEFAULT_MODEL = "claude-test-model";
			const { stdout } = await runExecCommand(["exec", "analyst", "--dry-run"]);
			expect(stdout).toContain("claude-test-model");
			delete process.env.AGENTFORGE_DEFAULT_MODEL;
		});

		it("shows custom model from --model flag", async () => {
			const { stdout } = await runExecCommand([
				"exec",
				"analyst",
				"--dry-run",
				"--model",
				"my-custom-model",
			]);
			expect(stdout).toContain("my-custom-model");
		});

		it("shows output dir from --output flag", async () => {
			const { stdout } = await runExecCommand([
				"exec",
				"analyst",
				"--dry-run",
				"--output",
				"/tmp/custom-out",
			]);
			expect(stdout).toContain("/tmp/custom-out");
		});

		it("shows input file when --input is specified", async () => {
			const { stdout } = await runExecCommand([
				"exec",
				"analyst",
				"--dry-run",
				"--input",
				"/tmp/input.txt",
			]);
			expect(stdout).toContain("/tmp/input.txt");
		});

		it("shows prompt when --prompt is specified", async () => {
			const { stdout } = await runExecCommand([
				"exec",
				"analyst",
				"--dry-run",
				"--prompt",
				"Build a todo app",
			]);
			expect(stdout).toContain("Build a todo app");
		});

		it("shows tools for developer (has tools)", async () => {
			const { stdout } = await runExecCommand([
				"exec",
				"developer",
				"--dry-run",
			]);
			expect(stdout).toContain("DRY RUN");
		});

		it("shows inputs and outputs", async () => {
			const { stdout } = await runExecCommand(["exec", "analyst", "--dry-run"]);
			expect(stdout).toContain("Inputs");
			expect(stdout).toContain("Outputs");
		});
	});

	describe("unknown agent", () => {
		it("sets exitCode = 1 for unknown agent", async () => {
			await runExecCommand(["exec", "unknown-agent", "--dry-run"]);
			expect(process.exitCode).toBe(1);
		});

		it("shows error message for unknown agent", async () => {
			const { stderr } = await runExecCommand([
				"exec",
				"unknown-agent",
				"--dry-run",
			]);
			expect(stderr).toContain("Unknown agent");
			expect(stderr).toContain("unknown-agent");
		});

		it("lists available agents in error", async () => {
			const { stderr } = await runExecCommand([
				"exec",
				"nonexistent",
				"--dry-run",
			]);
			expect(stderr).toContain("analyst");
		});
	});

	describe("config loading failure", () => {
		// Set to empty string rather than `delete` — config.ts calls dotenv which
		// would otherwise reload ANTHROPIC_API_KEY from the repo's .env file and
		// defeat the test. dotenv won't overwrite a variable that's already set,
		// even to an empty string, so the validation path fires as expected.
		it("sets exitCode = 1 when API key is missing", async () => {
			const savedKey = process.env.ANTHROPIC_API_KEY;
			process.env.ANTHROPIC_API_KEY = "";

			await runExecCommand(["exec", "analyst"]);
			expect(process.exitCode).toBe(1);

			if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
			else delete process.env.ANTHROPIC_API_KEY;
		});

		it("shows error when API key is missing", async () => {
			const savedKey = process.env.ANTHROPIC_API_KEY;
			process.env.ANTHROPIC_API_KEY = "";

			const { stderr } = await runExecCommand(["exec", "analyst"]);
			expect(stderr.length).toBeGreaterThan(0);

			if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
			else delete process.env.ANTHROPIC_API_KEY;
		});
	});
});
