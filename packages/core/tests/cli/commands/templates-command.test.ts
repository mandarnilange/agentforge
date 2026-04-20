import { Command } from "commander";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { registerTemplatesCommand } from "../../../src/cli/commands/templates.js";
import type { TemplateManifest } from "../../../src/templates/registry.js";

const extraTemplate: TemplateManifest = {
	name: "extra-template",
	displayName: "Extra Template",
	description: "Custom extension template for testing",
	tags: ["test"],
	agents: 2,
	executor: "pi-ai",
	path: "/fake/path",
};

describe("registerTemplatesCommand", () => {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

	afterEach(() => {
		logSpy.mockClear();
	});

	afterAll(() => {
		logSpy.mockRestore();
	});

	it("registers 'templates' parent and 'list' subcommand", () => {
		const program = new Command();
		registerTemplatesCommand(program);
		const templates = program.commands.find((c) => c.name() === "templates");
		expect(templates).toBeDefined();
		expect(templates?.commands.find((c) => c.name() === "list")).toBeDefined();
	});

	it("lists core templates when invoked", async () => {
		const program = new Command().exitOverride();
		registerTemplatesCommand(program);
		await program.parseAsync(["node", "cli", "templates", "list"]);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("blank");
		expect(output).toContain("simple-sdlc");
		expect(output).toContain("Usage: agentforge init --template");
	});

	it("includes extra platform templates passed in", async () => {
		const program = new Command().exitOverride();
		registerTemplatesCommand(program, [extraTemplate]);
		await program.parseAsync(["node", "cli", "templates", "list"]);

		const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
		expect(output).toContain("extra-template");
		expect(output).toContain("Custom extension template");
	});
});
