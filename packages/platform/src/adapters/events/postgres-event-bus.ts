/**
 * PostgresEventBus — multi-replica IEventBus over LISTEN/NOTIFY (P45-T3).
 *
 * Each control-plane replica opens a dedicated pg client and `LISTEN`s on
 * a shared channel. `emit` issues `NOTIFY` so every replica's subscribers
 * (dashboard SSE, reconcilers, etc.) see the same event stream. Local
 * subscribers also receive the event synchronously so the emitting
 * process's UI does not wait for the round-trip through Postgres.
 *
 * The listener client is dedicated — pg recommends keeping it idle so
 * notifications are delivered promptly. Outgoing `pg_notify` calls go
 * through a separate pool to avoid contending with the listener.
 *
 * Payloads exceed Postgres' 8000-byte NOTIFY limit only for unusual
 * StatusUpdate shapes — at that point we drop the cross-replica
 * delivery rather than fail the emit.
 */

import type {
	IEventBus,
	PipelineEvent,
} from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import pg from "pg";

const NOTIFY_PAYLOAD_LIMIT = 7900;
// Strict identifier guard. LISTEN/UNLISTEN take SQL identifiers, not
// parameters, so callers must pre-validate the channel name.
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class PostgresEventBus implements IEventBus {
	private readonly connectionString: string;
	private client: pg.Client;
	/**
	 * Separate pool for outgoing pg_notify calls. The pg docs recommend
	 * the LISTEN client stay idle — issuing other queries on the same
	 * connection can delay or drop notifications. Pool size is small
	 * because emit is fire-and-forget and short-lived.
	 */
	private readonly notifyPool: pg.Pool;
	private readonly listeners = new Set<(event: PipelineEvent) => void>();
	private started = false;

	constructor(
		connectionString: string,
		private readonly channel: string = "agentforge",
	) {
		if (!IDENTIFIER_RE.test(channel)) {
			throw new Error(
				`Invalid channel name "${channel}" — must match ${IDENTIFIER_RE} (LISTEN/UNLISTEN take identifiers, not parameters).`,
			);
		}
		this.connectionString = connectionString;
		this.client = this.makeClient();
		this.notifyPool = new pg.Pool({ connectionString, max: 2 });
	}

	private makeClient(): pg.Client {
		const c = new pg.Client({ connectionString: this.connectionString });
		c.on("notification", (msg) => {
			if (!msg.payload) return;
			let event: PipelineEvent;
			try {
				event = JSON.parse(msg.payload) as PipelineEvent;
			} catch {
				return;
			}
			this.deliver(event);
		});
		return c;
	}

	async start(): Promise<void> {
		if (this.started) return;
		await this.client.connect();
		try {
			// Channel is constructor-validated; safe to interpolate.
			await this.client.query(`LISTEN ${this.channel}`);
		} catch (err) {
			// LISTEN failed but connect succeeded → calling start() again on
			// the same client would throw "Client is already connected" and
			// also leak the previous notification listener. Tear down and
			// rebuild so the caller can retry cleanly.
			try {
				await this.client.end();
			} catch {
				// already broken; nothing to recover
			}
			this.client = this.makeClient();
			throw err;
		}
		this.started = true;
	}

	emit(event: PipelineEvent): void {
		// Notify peers asynchronously; deliver locally synchronously so a
		// dashboard rendered in the emitting process sees the event without
		// waiting for the round-trip.
		this.deliver(event);
		const payload = JSON.stringify(event);
		if (payload.length > NOTIFY_PAYLOAD_LIMIT) {
			console.warn(
				`PostgresEventBus: dropping cross-replica delivery — payload (${payload.length}B) exceeds NOTIFY limit (${NOTIFY_PAYLOAD_LIMIT}B). type=${event.type}`,
			);
			return;
		}
		void this.notifyPool
			.query("SELECT pg_notify($1, $2)", [this.channel, payload])
			.catch(() => {
				// Best-effort: if the notify pool is unavailable, peers won't
				// see the event. Local subscribers were already notified above.
			});
	}

	subscribe(listener: (event: PipelineEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private deliver(event: PipelineEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Resilient: do not let one bad subscriber break the rest.
			}
		}
	}

	async close(): Promise<void> {
		// allSettled so a failure tearing down the listener client does not
		// leak the notify pool's connections (or vice versa).
		await Promise.allSettled([
			(async () => {
				try {
					await this.client.query(`UNLISTEN ${this.channel}`);
				} catch {
					// Connection may already be closed.
				}
				await this.client.end();
			})(),
			this.notifyPool.end(),
		]);
	}
}
