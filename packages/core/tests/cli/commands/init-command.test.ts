/**
 * Tests the commander wiring for `init` — covers lines 256-284 of init.ts
 * (command registration, action callback, printed instructions).
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerInitCommand } from "../../../src/cli/commands/init.js";

describe("registerInitCommand", () => {
	let tmpDir: string;
	let cwdSpy: ReturnType<typeof vi.spyOn>;
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`agentforge-init-cmd-test-${randomBytes(4).toString("hex")}`,
		);
		mkdirSync(tmpDir, { recursive: true });
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		cwdSpy.mockRestore();
		logSpy.mockRestore();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("registers the init subcommand with template and force options", () => {
		const program = new Command();
		registerInitCommand(program);
		const init = program.commands.find((c) => c.name() === "init");
		expect(init).toBeDefined();
		const opts = init?.options.map((o) => o.long) ?? [];
		expect(opts).toContain("--template");
		expect(opts).toContain("--force");
	});

	it("scaffolds a blank template into cwd and prints next steps", async () => {
		const program = new Command().exitOverride();
		registerInitCommand(program);
		await program.parseAsync(["node", "test", "init", "--template", "blank"]);

		expect(existsSync(join(tmpDir, ".agentforge", "agents"))).toBe(true);
		const messages = logSpy.mock.calls.map((c) => c[0] as string);
		expect(messages.some((m) => m.includes("Scaffolded .agentforge/"))).toBe(
			true,
		);
		expect(messages.some((m) => m.includes("Run: agentforge list"))).toBe(true);
	});

	it("routes to platformResolver for non-core templates", async () => {
		const resolver = vi.fn().mockReturnValue(null);
		const program = new Command().exitOverride();
		registerInitCommand(program, resolver);
		// Will fall back to blank scaffold after resolver returns null
		await program.parseAsync([
			"node",
			"test",
			"init",
			"--template",
			"platform-only-template",
		]);

		expect(resolver).toHaveBeenCalledWith("platform-only-template");
		expect(existsSync(join(tmpDir, ".agentforge", "agents"))).toBe(true);
	});

	it("defaults to blank template when --template is omitted", async () => {
		const program = new Command().exitOverride();
		registerInitCommand(program);
		await program.parseAsync(["node", "test", "init"]);

		const messages = logSpy.mock.calls.map((c) => c[0] as string);
		expect(messages.some((m) => m.includes('"blank" template'))).toBe(true);
	});
});
