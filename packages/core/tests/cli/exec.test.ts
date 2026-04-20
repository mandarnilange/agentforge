import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerExecCommand } from "../../src/cli/commands/exec.js";

describe("exec command registration", () => {
	it("registers exec as a sub-command with required agent argument", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		expect(execCmd).toBeDefined();
	});

	it("has --input option", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const inputOpt = execCmd?.options.find((o) => o.long === "--input");
		expect(inputOpt).toBeDefined();
	});

	it("has --output option", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const outputOpt = execCmd?.options.find((o) => o.long === "--output");
		expect(outputOpt).toBeDefined();
	});

	it("has --prompt option", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const promptOpt = execCmd?.options.find((o) => o.long === "--prompt");
		expect(promptOpt).toBeDefined();
	});

	it("has --model option", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const modelOpt = execCmd?.options.find((o) => o.long === "--model");
		expect(modelOpt).toBeDefined();
	});

	it("has --verbose flag", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const verboseOpt = execCmd?.options.find((o) => o.long === "--verbose");
		expect(verboseOpt).toBeDefined();
	});

	it("has --dry-run flag", () => {
		const program = new Command();
		registerExecCommand(program);

		const execCmd = program.commands.find((c) => c.name() === "exec");
		const dryRunOpt = execCmd?.options.find((o) => o.long === "--dry-run");
		expect(dryRunOpt).toBeDefined();
	});
});
