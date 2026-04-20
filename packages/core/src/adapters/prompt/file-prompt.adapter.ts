/**
 * FilePromptLoader — file system implementation of IPromptLoader.
 * Loads system prompts from .md files on disk.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IPromptLoader } from "../../domain/ports/prompt-loader.port.js";

export class FilePromptLoader implements IPromptLoader {
	private readonly promptsDir: string;

	constructor(promptsDir: string) {
		this.promptsDir = promptsDir;
	}

	async load(agentId: string): Promise<string> {
		const filePath = join(this.promptsDir, `${agentId}.system.md`);
		return readFile(filePath, "utf-8");
	}
}
