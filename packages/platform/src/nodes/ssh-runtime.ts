import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import type { NodeDefinitionYaml } from "@mandarnilange/agentforge-core/definitions/parser.js";
import type {
	INodeRuntime,
	NodeRunRequest,
	NodeRunResult,
} from "@mandarnilange/agentforge-core/domain/ports/node-runtime.port.js";

const execFileAsync = promisify(execFile);

export class SshNodeRuntime implements INodeRuntime {
	readonly nodeDefinition: NodeDefinitionYaml;
	private readonly remoteCommand: string;

	constructor(nodeDefinition: NodeDefinitionYaml, remoteCommand?: string) {
		this.nodeDefinition = nodeDefinition;
		this.remoteCommand = remoteCommand ?? "sdlc-agent-node-runner";
	}

	ping(): Promise<boolean> {
		const host = this.nodeDefinition.spec.connection?.host;
		if (!host) return Promise.resolve(false);

		return new Promise((resolve) => {
			const socket = connect({ host, port: 22, timeout: 3000 });
			socket.once("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.once("error", () => resolve(false));
			socket.once("timeout", () => {
				socket.destroy();
				resolve(false);
			});
		});
	}

	async execute(request: NodeRunRequest): Promise<NodeRunResult> {
		const start = Date.now();
		const host = this.nodeDefinition.spec.connection?.host;
		const user = this.nodeDefinition.spec.connection?.user;
		if (!host) {
			return {
				runId: request.runId,
				success: false,
				error: "SSH node is missing host configuration",
				durationMs: 0,
			};
		}

		const target = user ? `${user}@${host}` : host;
		const payload = Buffer.from(JSON.stringify(request), "utf-8").toString(
			"base64",
		);
		const remoteShell = `printf '%s' '${payload}' | ${this.remoteCommand}`;

		try {
			const { stdout } = await execFileAsync("ssh", [target, remoteShell], {
				timeout: 30_000,
				maxBuffer: 10 * 1024 * 1024,
			});
			const parsed = JSON.parse(stdout) as NodeRunResult;
			return {
				...parsed,
				runId: parsed.runId || request.runId,
				durationMs: Date.now() - start,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				runId: request.runId,
				success: false,
				error: `SSH execution failed: ${message}`,
				durationMs: Date.now() - start,
			};
		}
	}
}
