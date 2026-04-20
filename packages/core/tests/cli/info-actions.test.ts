/**
 * Tests for the info CLI command action callback.
 */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerInfoCommand } from "../../src/cli/commands/info.js";

async function runInfoCommand(
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
	registerInfoCommand(program);

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

describe("info command action", () => {
	it("prints detailed info for analyst", async () => {
		const { stdout } = await runInfoCommand(["info", "analyst"]);
		expect(stdout).toContain("Analyst");
	});

	it("prints executor for developer", async () => {
		const { stdout } = await runInfoCommand(["info", "developer"]);
		expect(stdout).toContain("pi-coding-agent");
	});

	it("prints error for unknown agent", async () => {
		const mockExit = vi
			.spyOn(process, "exit")
			.mockImplementation(() => undefined as never);
		const { stderr } = await runInfoCommand(["info", "unknown-agent"]);
		expect(stderr).toContain("Unknown agent");
		expect(stderr).toContain("unknown-agent");
		mockExit.mockRestore();
	});

	it("includes phase in output", async () => {
		const { stdout } = await runInfoCommand(["info", "analyst"]);
		expect(stdout).toContain("Phase");
	});

	it("includes inputs/outputs in output", async () => {
		const { stdout } = await runInfoCommand(["info", "analyst"]);
		expect(stdout).toMatch(/Inputs|Outputs/);
	});
});
