/**
 * IActiveRunCounter — pluggable per-node active-run counter (P45-T6).
 *
 * The scheduler reads counts via this port before every dispatch decision.
 *
 *   - MemoryActiveRunCounter: single-process default, backs the in-memory map.
 *   - DbActiveRunCounter: queries `agent_runs WHERE status IN ('running','scheduled')
 *     GROUP BY node_name` so multiple control-plane replicas see the same
 *     truth and can never over-schedule a node beyond its maxConcurrentRuns.
 */

export interface IActiveRunCounter {
	/** Active-run count for `nodeName`. Always async to allow DB-backed impls. */
	count(nodeName: string): Promise<number>;

	/** Record that a run has started — may be a no-op for stateless impls. */
	recordStarted(nodeName: string): Promise<void>;

	/** Record that a run has completed — may be a no-op for stateless impls. */
	recordCompleted(nodeName: string): Promise<void>;
}
