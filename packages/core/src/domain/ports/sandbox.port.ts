/**
 * ISandboxProvider / ISandbox — ports for isolated code execution.
 * ZERO external dependencies.
 */

export interface SandboxOptions {
	readonly image: string;
	readonly memory?: string;
	readonly timeout?: number;
}

export interface RunOptions {
	readonly cwd?: string;
	readonly timeout?: number;
	readonly env?: Record<string, string>;
}

export interface RunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface ISandbox {
	run(command: string, options?: RunOptions): Promise<RunResult>;
	writeFile(path: string, content: string | Buffer): Promise<void>;
	readFile(path: string): Promise<string>;
	copyIn(localPath: string, sandboxPath: string): Promise<void>;
	copyOut(sandboxPath: string, localPath: string): Promise<void>;
	destroy(): Promise<void>;
}

export interface ISandboxProvider {
	create(options: SandboxOptions): Promise<ISandbox>;
}
