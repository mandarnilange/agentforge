/**
 * Tests for the exec CLI real-run path (lines 116-167).
 * Mocks the container + runner so we exercise the success + failure branches
 * without hitting a real LLM.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/di/container.js", () => ({
	createContainerForAgent: vi.fn(() => ({
		/* opaque container — runner uses it, we only care the factory was called */
	})),
}));

const runMock = vi.fn();
vi.mock("../../src/agents/runner.js", () => ({
	createAgent: vi.fn(() => ({ run: runMock })),
}));

async function runExec(args: string[]): Promise<{
	stdout: string;
	stderr: string;
}> {
	const logs: string[] = [];
	const errs: string[] = [];
	const logSpy = vi
		.spyOn(console, "log")
		.mockImplementation((...a: unknown[]) => {
			logs.push(a.join(" "));
		});
	const errSpy = vi
		.spyOn(console, "error")
		.mockImplementation((...a: unknown[]) => {
			errs.push(a.join(" "));
		});

	const { registerExecCommand } = await import(
		"../../src/cli/commands/exec.js"
	);
	const program = new Command().exitOverride();
	registerExecCommand(program);

	try {
		await program.parseAsync(["node", "test", ...args]);
	} catch {
		// commander exit
	} finally {
		logSpy.mockRestore();
		errSpy.mockRestore();
	}

	return { stdout: logs.join("\n"), stderr: errs.join("\n") };
}

describe("exec — real-run path", () => {
	const originalKey = process.env.ANTHROPIC_API_KEY;

	beforeEach(() => {
		// Ensure config loads successfully — tests mock the runner anyway
		if (!process.env.ANTHROPIC_API_KEY) {
			process.env.ANTHROPIC_API_KEY = "sk-test-key";
		}
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	afterEach(() => {
		if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
		else delete process.env.ANTHROPIC_API_KEY;
		process.exitCode = undefined;
	});

	it("prints artifacts and duration summary on successful run", async () => {
		runMock.mockResolvedValue({
			artifacts: [
				{ path: "frd.json", type: "frd" },
				{ path: "nfr.json", type: "nfr" },
			],
			tokenUsage: { inputTokens: 1200, outputTokens: 850 },
			durationMs: 4200,
			savedFiles: ["/tmp/out/frd.json"],
		});

		const { stdout } = await runExec(["exec", "analyst"]);

		expect(stdout).toContain("Summary");
		expect(stdout).toContain("Artifacts produced: 2");
		expect(stdout).toContain("frd.json");
		expect(stdout).toContain("1200 in / 850 out");
		expect(stdout).toContain("Duration: 4.2s");
		expect(stdout).toContain("Saved: /tmp/out/frd.json");
		expect(process.exitCode).not.toBe(1);
	});

	it("sets exitCode and prints error message when the runner throws", async () => {
		runMock.mockRejectedValue(new Error("LLM exploded"));

		const { stderr } = await runExec(["exec", "analyst"]);

		expect(stderr).toContain("LLM exploded");
		expect(process.exitCode).toBe(1);
	});

	it("handles non-Error rejections with fallback message", async () => {
		runMock.mockRejectedValue("just a string");

		const { stderr } = await runExec(["exec", "analyst"]);

		expect(stderr).toContain("Unknown error");
		expect(process.exitCode).toBe(1);
	});
});
