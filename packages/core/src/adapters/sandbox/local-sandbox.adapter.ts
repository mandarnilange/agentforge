import { execFile } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
	ISandbox,
	ISandboxProvider,
	RunOptions,
	RunResult,
	SandboxOptions,
} from "../../domain/ports/sandbox.port.js";

const execFileAsync = promisify(execFile);

export class LocalSandbox implements ISandbox {
	readonly workdir: string;

	constructor(workdir: string) {
		this.workdir = workdir;
	}

	async run(command: string, options?: RunOptions): Promise<RunResult> {
		const cwd = options?.cwd ?? this.workdir;
		const env = options?.env ? { ...process.env, ...options.env } : process.env;
		const timeout = options?.timeout;

		try {
			const { stdout, stderr } = await execFileAsync(
				"/bin/sh",
				["-c", command],
				{
					cwd,
					env: env as NodeJS.ProcessEnv,
					...(timeout ? { timeout } : {}),
				},
			);
			return { exitCode: 0, stdout, stderr };
		} catch (err: unknown) {
			const e = err as NodeJS.ErrnoException & {
				stdout?: string;
				stderr?: string;
				code?: number | string;
			};
			return {
				exitCode: typeof e.code === "number" ? e.code : 1,
				stdout: e.stdout ?? "",
				stderr: e.stderr ?? "",
			};
		}
	}

	async writeFile(path: string, content: string | Buffer): Promise<void> {
		const abs = this.#resolve(path);
		await mkdir(dirname(abs), { recursive: true });
		await writeFile(abs, content);
	}

	async readFile(path: string): Promise<string> {
		const abs = this.#resolve(path);
		return readFile(abs, "utf-8");
	}

	async copyIn(localPath: string, sandboxPath: string): Promise<void> {
		const dest = this.#resolve(sandboxPath);
		await mkdir(dirname(dest), { recursive: true });
		await copyFile(localPath, dest);
	}

	async copyOut(sandboxPath: string, localPath: string): Promise<void> {
		const src = this.#resolve(sandboxPath);
		await mkdir(dirname(localPath), { recursive: true });
		await copyFile(src, localPath);
	}

	async destroy(): Promise<void> {
		await rm(this.workdir, { recursive: true, force: true });
	}

	#resolve(path: string): string {
		return isAbsolute(path) ? path : join(this.workdir, path);
	}
}

export class LocalSandboxProvider implements ISandboxProvider {
	async create(_options: SandboxOptions): Promise<ISandbox> {
		console.warn(
			"[LocalSandbox] WARNING: no isolation — running commands directly on host. Dev/test only.",
		);
		const workdir = await mkdtemp(join(tmpdir(), "sdlc-sandbox-"));
		return new LocalSandbox(workdir);
	}
}
