/**
 * LocalLeaderElector — single-process leader (P45-T5).
 * Acquire always succeeds; release flips state. Use for single-replica
 * deployments or when no shared store is available.
 */

import type { ILeaderElector } from "../../domain/ports/leader-elector.port.js";

export class LocalLeaderElector implements ILeaderElector {
	private readonly held = new Set<string>();

	acquire(lockName: string): Promise<boolean> {
		// Mutual exclusion: only the *first* caller for a given name wins.
		// Without this, two runWhenLeader instances in the same process (e.g.
		// reconciler + scheduler that share a lock by mistake) would both
		// believe they are leader, defeating the contract.
		if (this.held.has(lockName)) return Promise.resolve(false);
		this.held.add(lockName);
		return Promise.resolve(true);
	}

	release(lockName: string): Promise<void> {
		this.held.delete(lockName);
		return Promise.resolve();
	}

	isLeader(lockName: string): boolean {
		return this.held.has(lockName);
	}
}
