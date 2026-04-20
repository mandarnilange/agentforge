import { Command } from "commander";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { registerListCommand } from "../../../src/cli/commands/list.js";

describe("registerListCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	afterEach(() => {
		logSpy.mockClear();
	});

	afterAll(() => {
		logSpy.mockRestore();
	});

	it("registers the list subcommand with description", () => {
		const program = new Command();
		registerListCommand(program);
		const list = program.commands.find((c) => c.name() === "list");
		expect(list).toBeDefined();
		expect(list?.description()).toMatch(/list/i);
	});

	it("prints a table containing the simple-sdlc starter agents", async () => {
		const program = new Command().exitOverride();
		registerListCommand(program);
		await program.parseAsync(["node", "cli", "list"]);

		expect(logSpy).toHaveBeenCalledTimes(1);
		const output = logSpy.mock.calls[0]?.[0] as string;
		for (const name of ["Analyst", "Architect", "Developer"]) {
			expect(output).toContain(name);
		}
	});
});
