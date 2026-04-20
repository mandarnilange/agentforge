import { trace } from "@opentelemetry/api";
import type { IStateStore } from "../domain/ports/state-store.port.js";

// Tracer is acquired lazily on every call rather than captured at module load.
// If a NodeSDK provider (platform side) registers AFTER this module is imported,
// a captured reference would stay a no-op forever and spans would silently drop.
export function traceStateStore(store: IStateStore): IStateStore {
	return new Proxy(store, {
		get(target, prop, receiver) {
			const original = Reflect.get(target, prop, receiver);
			if (typeof original !== "function") return original;

			const methodName = String(prop);
			return (...args: unknown[]) => {
				const span = trace
					.getTracer("sdlc-agent")
					.startSpan(`db.${methodName}`);
				span.setAttribute("db.system", "sqlite");
				span.setAttribute("db.operation", methodName);
				if (args[0] !== undefined && typeof args[0] === "string") {
					span.setAttribute("db.params.id", args[0]);
				}
				try {
					const result = original.apply(target, args);
					if (result instanceof Promise) {
						return result
							.then((val: unknown) => {
								span.end();
								return val;
							})
							.catch((err: Error) => {
								span.setStatus({
									code: 2, // ERROR
									message: err.message,
								});
								span.end();
								throw err;
							});
					}
					span.end();
					return result;
				} catch (err) {
					span.setStatus({
						code: 2,
						message: err instanceof Error ? err.message : String(err),
					});
					span.end();
					throw err;
				}
			};
		},
	});
}
