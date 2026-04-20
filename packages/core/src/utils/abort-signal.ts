/**
 * Combine abort signals — returns an AbortSignal that fires when ANY of the
 * inputs fire, or when the optional timeout elapses.
 *
 * Used to wrap user-supplied cancellation signals with a wall-clock timeout
 * so that runaway LLM calls cannot burn arbitrary amounts of time or money.
 */

export interface TimeoutSignalOptions {
	/** User-supplied signal to honour; when aborted, the combined signal aborts. */
	readonly signal?: AbortSignal;
	/** Wall-clock timeout in milliseconds; <=0 or undefined means no timeout. */
	readonly timeoutMs?: number;
	/** Reason string for the timeout path. */
	readonly timeoutReason?: string;
}

export interface ComposedSignal {
	readonly signal: AbortSignal;
	/** Whether the composed signal was aborted specifically due to the timeout. */
	timedOut(): boolean;
	/** Clear pending timer and listener — call once the protected op finishes. */
	dispose(): void;
}

/**
 * Return true when `err` was thrown because a timeout aborted the operation.
 * Callers can use this to convert an AbortError into a clearer timeout error.
 */
export function isTimeoutAbortError(
	err: unknown,
	composed: ComposedSignal,
): boolean {
	if (!composed.timedOut()) return false;
	if (err instanceof Error) {
		return err.name === "AbortError" || /abort/i.test(err.message);
	}
	return false;
}

export function composeTimeoutSignal(
	options: TimeoutSignalOptions,
): ComposedSignal {
	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let userAbortListener: (() => void) | undefined;

	if (options.signal) {
		if (options.signal.aborted) {
			controller.abort(options.signal.reason);
		} else {
			userAbortListener = () => {
				controller.abort(options.signal?.reason);
			};
			options.signal.addEventListener("abort", userAbortListener, {
				once: true,
			});
		}
	}

	const timeoutMs = options.timeoutMs;
	if (timeoutMs !== undefined && timeoutMs > 0) {
		timer = setTimeout(() => {
			timedOut = true;
			const reason = new Error(
				options.timeoutReason ??
					`LLM call timed out after ${Math.round(timeoutMs / 1000)}s`,
			);
			reason.name = "TimeoutError";
			controller.abort(reason);
		}, timeoutMs);
		// Don't keep the Node.js event loop alive just for this timer.
		if (typeof (timer as { unref?: () => void }).unref === "function") {
			(timer as { unref: () => void }).unref();
		}
	}

	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose: () => {
			if (timer) clearTimeout(timer);
			if (options.signal && userAbortListener) {
				options.signal.removeEventListener("abort", userAbortListener);
			}
		},
	};
}
