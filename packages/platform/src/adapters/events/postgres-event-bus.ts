/**
 * PostgresEventBus — multi-replica IEventBus over LISTEN/NOTIFY (P45-T3).
 *
 * Each control-plane replica opens a dedicated pg client and `LISTEN`s on
 * a shared channel. `emit` issues `NOTIFY` so every replica's subscribers
 * (dashboard SSE, reconcilers, etc.) see the same event stream. Local
 * subscribers also receive the event synchronously so the emitting
 * process's UI does not wait for the round-trip through Postgres.
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

export class PostgresEventBus implements IEventBus {
	private readonly client: pg.Client;
	private readonly listeners = new Set<(event: PipelineEvent) => void>();

	constructor(
		connectionString: string,
		private readonly channel: string = "agentforge",
	) {
		this.client = new pg.Client({ connectionString });
	}

	async start(): Promise<void> {
		await this.client.connect();
		this.client.on("notification", (msg) => {
			if (!msg.payload) return;
			let event: PipelineEvent;
			try {
				event = JSON.parse(msg.payload) as PipelineEvent;
			} catch {
				return;
			}
			this.deliver(event);
		});
		// Channel names come from config / code, not user input. Quoting them
		// would force Postgres to treat them as case-sensitive identifiers
		// which is not what we want here.
		await this.client.query(`LISTEN ${this.channel}`);
	}

	emit(event: PipelineEvent): void {
		// Notify peers asynchronously; deliver locally synchronously so a
		// dashboard rendered in the emitting process sees the event without
		// waiting for the round-trip.
		this.deliver(event);
		const payload = JSON.stringify(event);
		if (payload.length > NOTIFY_PAYLOAD_LIMIT) return;
		void this.client
			.query("SELECT pg_notify($1, $2)", [this.channel, payload])
			.catch(() => {
				// Best-effort: if the LISTEN connection drops, peers won't see
				// the event. Local subscribers were already notified above.
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
		try {
			await this.client.query(`UNLISTEN ${this.channel}`);
		} catch {
			// Connection may already be closed.
		}
		await this.client.end();
	}
}
