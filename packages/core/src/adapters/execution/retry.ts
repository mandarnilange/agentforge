/**
 * Retry helper for LLM calls that fail with transient errors.
 *
 * Used by execution backends to retry calls that fail with Anthropic
 * overloaded_error (HTTP 529) or other retryable transient errors with
 * exponential backoff.
 */

export interface RetryOptions {
	/** Maximum attempts (including the initial attempt). Default: 3. */
	readonly maxAttempts?: number;
	/** Initial backoff in milliseconds. Default: 2000. */
	readonly initialBackoffMs?: number;
	/** Backoff multiplier. Default: 2 (exponential). */
	readonly backoffMultiplier?: number;
	/** Optional callback invoked between attempts. */
	readonly onRetry?: (info: {
		attempt: number;
		delayMs: number;
		error: unknown;
	}) => void;
	/** Abort signal — stops further retries if aborted. */
	readonly signal?: AbortSignal;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 2000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

/** Return true when the error is an Anthropic overloaded_error (HTTP 529). */
export function isOverloadedError(err: unknown): boolean {
	const msg = extractMessage(err);
	if (!msg) return false;
	// Cheap string checks first — avoid JSON.parse for common cases
	if (/\boverloaded_error\b/i.test(msg)) return true;
	if (/\b529\b/.test(msg) && /overloaded/i.test(msg)) return true;
	// Try JSON parse — pi-ai surfaces stringified error payloads
	const parsed = tryParseJson(msg);
	if (parsed && typeof parsed === "object") {
		const obj = parsed as Record<string, unknown>;
		const errorField = obj.error as Record<string, unknown> | undefined;
		if (errorField && typeof errorField === "object") {
			if (errorField.type === "overloaded_error") return true;
		}
		if (obj.type === "overloaded_error") return true;
		if (obj.statusCode === 529 || obj.status === 529) return true;
	}
	return false;
}

function extractMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	if (err && typeof err === "object") {
		try {
			return JSON.stringify(err);
		} catch {
			return String(err);
		}
	}
	return String(err);
}

function tryParseJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}

/**
 * Extract a human-readable message from a (possibly JSON-encoded) error.
 * Anthropic errors often look like: `{"error":{"type":"overloaded_error","message":"Overloaded"}}`.
 */
export function humanizeErrorMessage(err: unknown): string {
	const raw = extractMessage(err);
	if (!raw) return "Unknown error";
	const parsed = tryParseJson(raw);
	if (parsed && typeof parsed === "object") {
		const obj = parsed as Record<string, unknown>;
		const errorField = obj.error as Record<string, unknown> | undefined;
		if (errorField && typeof errorField === "object") {
			const m = errorField.message;
			if (typeof m === "string" && m.length > 0) return m;
			const t = errorField.type;
			if (typeof t === "string" && t.length > 0) return t;
		}
		if (typeof obj.message === "string") return obj.message;
	}
	return raw;
}

/**
 * Run `fn` with retry + exponential backoff. Retries only when `shouldRetry`
 * returns true. Throws the final error after exhausting attempts.
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	shouldRetry: (err: unknown) => boolean,
	options: RetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const initialBackoffMs =
		options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
	const multiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error("Aborted");
		}
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			const isLast = attempt >= maxAttempts;
			if (isLast || !shouldRetry(err)) {
				throw err;
			}
			const delayMs = initialBackoffMs * multiplier ** (attempt - 1);
			options.onRetry?.({ attempt, delayMs, error: err });
			await sleep(delayMs, options.signal);
		}
	}
	// Unreachable, but satisfies TS
	throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("Aborted"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("Aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
