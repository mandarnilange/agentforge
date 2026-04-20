/**
 * InMemoryEventBus — simple EventEmitter-based pub/sub.
 * Ephemeral: events are not persisted. Subscribers are notified synchronously.
 * Resilient: a failing subscriber does not prevent other subscribers from receiving events.
 */

import type {
	IEventBus,
	PipelineEvent,
} from "../../domain/ports/event-bus.port.js";

export class InMemoryEventBus implements IEventBus {
	private readonly listeners = new Set<(event: PipelineEvent) => void>();

	emit(event: PipelineEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// Resilient: don't let a bad subscriber break others
			}
		}
	}

	subscribe(listener: (event: PipelineEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}
