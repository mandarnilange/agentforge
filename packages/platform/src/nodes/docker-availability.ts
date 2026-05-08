/**
 * Docker socket preflight (P40-T5).
 *
 * When a node advertises the "docker" capability we probe the local docker
 * daemon at registration time. Unavailable → warn once and strip "docker"
 * from the effective capability list so the node still registers (other
 * capabilities remain) but the scheduler does not route docker-required
 * jobs to a node that would immediately fail.
 *
 * The probe is injectable so callers can swap in a real dockerode ping or
 * a unix-socket connect; default uses a lightweight `/var/run/docker.sock`
 * (or DOCKER_HOST) connect attempt.
 */

import { connect } from "node:net";

export interface DockerAvailabilityOptions {
	/** Custom probe — returns true when docker is reachable. */
	probe?: () => Promise<boolean>;
	/** Override the unix socket path (default `/var/run/docker.sock`). */
	socketPath?: string;
	/** Override DOCKER_HOST (e.g. tcp://host:port); takes priority over socket. */
	dockerHost?: string;
	/** Probe timeout in ms (default 1500). */
	timeoutMs?: number;
}

const DEFAULT_SOCKET = "/var/run/docker.sock";
const DEFAULT_TIMEOUT_MS = 1500;

export async function checkDockerAvailability(
	opts: DockerAvailabilityOptions = {},
): Promise<boolean> {
	const probe = opts.probe ?? defaultProbe(opts);
	try {
		return await probe();
	} catch {
		return false;
	}
}

/**
 * Removes "docker" from `capabilities` when the daemon is unreachable.
 * Logs a single warning explaining the downgrade. Idempotent and safe when
 * "docker" is not present.
 */
export function filterDockerCapability(
	capabilities: readonly string[],
	dockerAvailable: boolean,
	warn: (msg: string) => void,
): string[] {
	if (!capabilities.includes("docker")) return [...capabilities];
	if (dockerAvailable) return [...capabilities];

	warn(
		"docker capability declared but the docker daemon is unavailable — " +
			"removing 'docker' from this node's effective capabilities. " +
			"Set DOCKER_HOST or start the daemon to restore docker scheduling.",
	);
	return capabilities.filter((c) => c !== "docker");
}

function defaultProbe(opts: DockerAvailabilityOptions): () => Promise<boolean> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const dockerHost = opts.dockerHost ?? process.env.DOCKER_HOST;
	const socketPath = opts.socketPath ?? DEFAULT_SOCKET;

	return () =>
		new Promise<boolean>((resolve) => {
			const tcpMatch = dockerHost?.match(/^tcp:\/\/([^:]+):(\d+)/);
			const socket = tcpMatch
				? connect({
						host: tcpMatch[1],
						port: Number(tcpMatch[2]),
						timeout: timeoutMs,
					})
				: connect({ path: socketPath, timeout: timeoutMs });

			const cleanup = (ok: boolean) => {
				socket.destroy();
				resolve(ok);
			};
			socket.once("connect", () => cleanup(true));
			socket.once("error", () => cleanup(false));
			socket.once("timeout", () => cleanup(false));
		});
}
