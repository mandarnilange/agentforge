import { describe, expect, it } from "vitest";
import {
	composeTimeoutSignal,
	isTimeoutAbortError,
} from "../../src/utils/abort-signal.js";

describe("composeTimeoutSignal", () => {
	it("returns a signal that fires when the user signal is aborted", () => {
		const user = new AbortController();
		const composed = composeTimeoutSignal({ signal: user.signal });
		expect(composed.signal.aborted).toBe(false);
		user.abort(new Error("user stop"));
		expect(composed.signal.aborted).toBe(true);
		expect(composed.timedOut()).toBe(false);
		composed.dispose();
	});

	it("starts already-aborted when the user signal is already aborted", () => {
		const user = new AbortController();
		user.abort(new Error("stop"));
		const composed = composeTimeoutSignal({ signal: user.signal });
		expect(composed.signal.aborted).toBe(true);
		composed.dispose();
	});

	it("fires from the timeout", async () => {
		const composed = composeTimeoutSignal({ timeoutMs: 5 });
		await new Promise((r) => setTimeout(r, 20));
		expect(composed.signal.aborted).toBe(true);
		expect(composed.timedOut()).toBe(true);
		composed.dispose();
	});

	it("ignores non-positive timeoutMs", async () => {
		const composed = composeTimeoutSignal({ timeoutMs: 0 });
		await new Promise((r) => setTimeout(r, 20));
		expect(composed.signal.aborted).toBe(false);
		expect(composed.timedOut()).toBe(false);
		composed.dispose();
	});

	it("timedOut() stays false when user aborts before timeout", async () => {
		const user = new AbortController();
		const composed = composeTimeoutSignal({
			signal: user.signal,
			timeoutMs: 50,
		});
		user.abort(new Error("user"));
		expect(composed.signal.aborted).toBe(true);
		expect(composed.timedOut()).toBe(false);
		composed.dispose();
	});

	it("isTimeoutAbortError detects abort-like errors after timeout", () => {
		const composed = composeTimeoutSignal({ timeoutMs: 1 });
		// Simulate a timed-out state
		// @ts-expect-error direct mutation for test only
		composed.timedOut = () => true;
		const abort = new Error("aborted");
		abort.name = "AbortError";
		expect(isTimeoutAbortError(abort, composed)).toBe(true);
		composed.dispose();
	});

	it("isTimeoutAbortError is false when timedOut() is false", () => {
		const composed = composeTimeoutSignal({});
		const abort = new Error("aborted");
		abort.name = "AbortError";
		expect(isTimeoutAbortError(abort, composed)).toBe(false);
		composed.dispose();
	});
});
