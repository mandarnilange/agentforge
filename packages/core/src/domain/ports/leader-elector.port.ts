/**
 * ILeaderElector — pluggable leader election for control-plane singleton
 * loops (P45-T5).
 *
 * Today PipelineRecoveryService and AgentScheduler each run their interval
 * loops on every replica → duplicate reconciler races, duplicate
 * scheduling decisions. The Postgres adapter uses session-scoped
 * `pg_advisory_lock(<int>)` so only one replica becomes leader; the lock
 * is released automatically when the holder process exits, so failover is
 * instant.
 *
 * The `LocalLeaderElector` is the single-process default — always leader.
 */

export interface ILeaderElector {
	/**
	 * Attempt to acquire the lock for `lockName`. Returns true if this
	 * caller is now the leader. Calling `acquire` while already leader is
	 * a no-op that returns true.
	 */
	acquire(lockName: string): Promise<boolean>;

	/** Release the lock. Idempotent. */
	release(lockName: string): Promise<void>;

	/** Is this elector currently the leader for `lockName`? */
	isLeader(lockName: string): boolean;
}
