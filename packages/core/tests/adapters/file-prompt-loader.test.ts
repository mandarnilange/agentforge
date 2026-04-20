import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilePromptLoader } from "../../src/adapters/prompt/file-prompt.adapter.js";

describe("FilePromptLoader", () => {
	let loader: FilePromptLoader;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "file-prompt-loader-"));
		loader = new FilePromptLoader(tempDir);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("load()", () => {
		it("should read prompt from {promptsDir}/{agentId}.system.md", async () => {
			const promptContent =
				"You are a spec writer agent.\n\nYour job is to write specs.";
			await writeFile(join(tempDir, "spec-writer.system.md"), promptContent);

			const result = await loader.load("spec-writer");

			expect(result).toBe(promptContent);
		});

		it("should throw if prompt file not found", async () => {
			await expect(loader.load("nonexistent-agent")).rejects.toThrow();
		});

		it("should return the full content of the prompt file", async () => {
			const multiLinePrompt = [
				"# System Prompt",
				"",
				"You are an AI agent.",
				"",
				"## Instructions",
				"- Do this",
				"- Do that",
			].join("\n");
			await writeFile(join(tempDir, "test-agent.system.md"), multiLinePrompt);

			const result = await loader.load("test-agent");

			expect(result).toBe(multiLinePrompt);
		});
	});

	describe("analyst prompt integration", () => {
		it("should load the analyst prompt and it should be non-empty", async () => {
			const projectRoot = resolve(
				import.meta.dirname,
				"../../../../.agentforge/prompts",
			);
			const realLoader = new FilePromptLoader(projectRoot);

			const prompt = await realLoader.load("analyst");

			expect(prompt).toBeDefined();
			expect(prompt.length).toBeGreaterThan(0);
		});
	});
});
