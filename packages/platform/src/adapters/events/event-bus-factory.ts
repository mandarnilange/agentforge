/**
 * Event-bus selector (P45-T3).
 *
 * Reads AGENTFORGE_EVENT_BUS at boot:
 *   - "memory" / unset  → InMemoryEventBus (single-process default)
 *   - "postgres"        → PostgresEventBus over LISTEN/NOTIFY when a URL
 *                         is available; otherwise warn and fall back to
 *                         memory rather than crash on a misconfigured env.
 *
 * The factory is intentionally narrow: callers configure once at startup
 * and pass the resulting bus into PipelineController, GateController,
 * dashboard SSE, etc.
 */

import { InMemoryEventBus } from "@mandarnilange/agentforge-core/adapters/events/in-memory-event-bus.js";
import type { IEventBus } from "@mandarnilange/agentforge-core/domain/ports/event-bus.port.js";
import { PostgresEventBus } from "./postgres-event-bus.js";

export interface EventBusFactoryOptions {
	postgresUrl?: string;
	channel?: string;
	warn?: (msg: string) => void;
}

export function buildEventBus(opts: EventBusFactoryOptions = {}): IEventBus {
	const choice = (process.env.AGENTFORGE_EVENT_BUS ?? "memory").toLowerCase();
	const warn = opts.warn ?? ((msg) => console.warn(msg));

	if (choice === "memory") return new InMemoryEventBus();

	if (choice === "postgres") {
		if (!opts.postgresUrl) {
			warn(
				"AGENTFORGE_EVENT_BUS=postgres but no Postgres URL is configured — " +
					"falling back to InMemoryEventBus. Set AGENTFORGE_POSTGRES_URL to enable cross-replica events.",
			);
			return new InMemoryEventBus();
		}
		return new PostgresEventBus(opts.postgresUrl, opts.channel);
	}

	throw new Error(
		`Unknown AGENTFORGE_EVENT_BUS=${choice} — supported values: memory, postgres`,
	);
}
