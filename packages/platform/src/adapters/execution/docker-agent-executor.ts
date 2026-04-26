/**
 * DockerAgentExecutor — launches a Docker container per agent job.
 * User provides the Docker image. Container follows the stdout JSON-lines
 * protocol for status streaming and writes _result.json on completion.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { resolveAgentforgeDir } from "@mandarnilange/agentforge-core/di/agentforge-dir.js";
import type {
	AgentJob,
	AgentJobResult,
	IAgentExecutor,
	StatusUpdate,
} from "@mandarnilange/agentforge-core/domain/ports/agent-executor.port.js";

/** Minimal Docker API interface (subset of dockerode) for testability. */
export interface DockerApi {
	createContainer(opts: Record<string, unknown>): Promise<DockerContainer>;
	listContainers(opts?: Record<string, unknown>): Promise<unknown[]>;
}

export interface DockerContainer {
	id: string;
	start(): Promise<void>;
	logs(opts: Record<string, unknown>): Promise<Readable>;
	wait(): Promise<{ StatusCode: number }>;
	remove(opts?: Record<string, unknown>): Promise<void>;
}

export interface DockerAgentExecutorOptions {
	docker: DockerApi;
	defaultImage: string;
}

export class DockerAgentExecutor implements IAgentExecutor {
	private readonly docker: DockerApi;
	private readonly defaultImage: string;

	constructor(options: DockerAgentExecutorOptions) {
		this.docker = options.docker;
		this.defaultImage = options.defaultImage;
	}

	async execute(
		job: AgentJob,
		onStatus?: (update: StatusUpdate) => void,
	): Promise<AgentJobResult> {
		const startTime = Date.now();

		try {
			onStatus?.({
				type: "started",
				runId: job.runId,
				timestamp: Date.now(),
			});

			const image = this.defaultImage;
			const memory = parseMemory(
				(job.agentDefinition.spec?.sandbox as Record<string, unknown>)
					?.memory as string | undefined,
			);

			const container = await this.docker.createContainer({
				Image: image,
				Env: [
					`AGENT_ID=${job.agentId}`,
					`RUN_ID=${job.runId}`,
					`MODEL_PROVIDER=${job.model.provider}`,
					`MODEL_NAME=${job.model.name}`,
					`MAX_TOKENS=${job.model.maxTokens}`,
				],
				HostConfig: {
					Binds: [
						`${job.workdir}:/workspace`,
						`${job.outputDir}:/output`,
						`${resolveAgentforgeDir()}:/agentforge:ro`,
					],
					Memory: memory,
				},
				Labels: { "agentforge.run-id": job.runId },
			});

			await container.start();

			// Stream stdout for status updates
			const logStream = await container.logs({
				follow: true,
				stdout: true,
				stderr: true,
			});
			this.parseStatusStream(logStream, onStatus);

			// Wait for container to finish
			const { StatusCode } = await container.wait();

			// Read _result.json from output dir
			const resultPath = join(job.outputDir, "_result.json");
			const resultData = existsSync(resultPath)
				? JSON.parse(readFileSync(resultPath, "utf-8"))
				: null;

			await container.remove({ force: true });

			const durationMs = Date.now() - startTime;

			onStatus?.({
				type: StatusCode === 0 ? "completed" : "failed",
				runId: job.runId,
				timestamp: Date.now(),
			});

			if (StatusCode !== 0) {
				return {
					status: "failed",
					artifacts: resultData?.artifacts ?? [],
					savedFiles: resultData?.savedFiles ?? [],
					tokenUsage: resultData?.tokenUsage ?? {
						inputTokens: 0,
						outputTokens: 0,
					},
					costUsd: resultData?.costUsd ?? 0,
					durationMs,
					conversationLog: resultData?.conversationLog ?? [],
					error: `Container exited with exit code ${StatusCode}`,
				};
			}

			return {
				status: "succeeded",
				artifacts: resultData?.artifacts ?? [],
				savedFiles: resultData?.savedFiles ?? [],
				tokenUsage: resultData?.tokenUsage ?? {
					inputTokens: 0,
					outputTokens: 0,
				},
				costUsd: resultData?.costUsd ?? 0,
				durationMs,
				conversationLog: resultData?.conversationLog ?? [],
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				status: "failed",
				artifacts: [],
				savedFiles: [],
				tokenUsage: { inputTokens: 0, outputTokens: 0 },
				costUsd: 0,
				durationMs: Date.now() - startTime,
				conversationLog: [],
				error: message,
			};
		}
	}

	async cancel(runId: string): Promise<void> {
		const containers = await this.docker.listContainers({
			filters: JSON.stringify({ label: [`agentforge.run-id=${runId}`] }),
		});
		for (const c of containers) {
			const container = c as unknown as DockerContainer;
			try {
				await container.remove({ force: true });
			} catch {
				// best effort
			}
		}
	}

	private parseStatusStream(
		stream: Readable,
		onStatus?: (update: StatusUpdate) => void,
	): void {
		if (!onStatus) return;

		let buffer = "";
		stream.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const parsed = JSON.parse(trimmed) as StatusUpdate;
					if (parsed.type) {
						onStatus(parsed);
					}
				} catch {
					// Not JSON — skip (could be stderr or non-protocol output)
				}
			}
		});
	}
}

function parseMemory(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const match = value.match(/^(\d+)([gmk])$/i);
	if (!match) return undefined;
	const num = Number.parseInt(match[1], 10);
	const unit = match[2].toLowerCase();
	switch (unit) {
		case "g":
			return num * 1024 * 1024 * 1024;
		case "m":
			return num * 1024 * 1024;
		case "k":
			return num * 1024;
		default:
			return undefined;
	}
}
