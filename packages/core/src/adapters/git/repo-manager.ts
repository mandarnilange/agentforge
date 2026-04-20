import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export class GitRepoManager {
	async initRepo(path: string, projectName: string): Promise<void> {
		await mkdir(path, { recursive: true });
		await run("git", ["init"], { cwd: path });
		await run(
			"git",
			["commit", "--allow-empty", "-m", `init: ${projectName}`],
			{ cwd: path },
		);
	}

	async commit(
		path: string,
		message: string,
		files?: string[],
	): Promise<string> {
		if (files) {
			await run("git", ["add", ...files], { cwd: path });
		} else {
			await run("git", ["add", "."], { cwd: path });
		}
		await run("git", ["commit", "-m", message], { cwd: path });
		const { stdout } = await run("git", ["rev-parse", "HEAD"], {
			cwd: path,
		});
		return stdout.trim();
	}

	async log(path: string, count = 5): Promise<string[]> {
		const { stdout } = await run("git", ["log", "--oneline", `-n${count}`], {
			cwd: path,
		});
		return stdout.trim().split("\n").filter(Boolean);
	}
}
