/**
 * runWhenLeader — wraps a singleton interval loop in leader election (P45-T5).
 *
 * Each tick: try to acquire the lock if we don't already hold it; if we
 * become (or remain) leader, run `body`. Otherwise skip and let another
 * replica do the work. The released-lock case is automatic on process
 * exit (Postgres advisory locks live with the session) — failover is
 * picked up at the next tick.
 */

import type { ILeaderElector } from "../domain/ports/leader-elector.port.js";

export function runWhenLeader(
	elector: ILeaderElector,
	lockName: string,
	body: () => Promise<void>,
	intervalMs: number,
): () => void {
	let stopped = false;

	const tick = async (): Promise<void> => {
		if (stopped) return;
		let leader = elector.isLeader(lockName);
		if (!leader) {
			leader = await elector.acquire(lockName);
		}
		if (!leader) return;
		try {
			await body();
		} catch {
			// Swallow — the interval must keep running so a transient
			// failure doesn't permanently disable the singleton loop.
		}
	};

	const handle = setInterval(() => {
		void tick();
	}, intervalMs);

	return () => {
		stopped = true;
		clearInterval(handle);
		// Best-effort release; if the elector has not held the lock this
		// is a no-op.
		void elector.release(lockName);
	};
}
