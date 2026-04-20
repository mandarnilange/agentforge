/**
 * Process-wide registry of sensitive values to redact from logs, audit
 * entries, conversation transcripts, dashboard views, and error messages.
 *
 * Keeping this in a single module lets any subsystem register a value (at
 * startup, when a secret is resolved, when an API response exposes a token)
 * and any log emission path can mask it without explicit plumbing.
 *
 * Registered values must be at least 6 characters to avoid trivial false
 * positives (e.g. masking the string "db" everywhere).
 */

const MIN_LENGTH = 6;
const registered = new Set<string>();

/** Register a sensitive value so it will be masked in future log output. */
export function registerSecret(value: string | undefined | null): void {
	if (!value) return;
	const trimmed = value.trim();
	if (trimmed.length < MIN_LENGTH) return;
	registered.add(trimmed);
}

/** Returns the full set of registered sensitive values (for tests). */
export function listRegisteredSecrets(): readonly string[] {
	return Array.from(registered);
}

/** Clear the registry. Intended for tests. */
export function clearSecretsForTest(): void {
	registered.clear();
}

/** Replace every occurrence of any registered secret in `input` with `***`. */
export function maskSecrets(input: string): string {
	if (!input) return input;
	let out = input;
	for (const secret of registered) {
		if (!secret) continue;
		// Replace with a fixed redaction. Avoid regex to prevent pattern
		// injection from the secret value.
		if (out.includes(secret)) {
			out = splitJoinReplace(out, secret, "***");
		}
	}
	return out;
}

/** Deep-mask any string leaves of an object; arrays and plain objects handled. */
export function maskSecretsDeep<T>(value: T): T {
	if (typeof value === "string") {
		return maskSecrets(value) as unknown as T;
	}
	if (Array.isArray(value)) {
		return value.map((v) => maskSecretsDeep(v)) as unknown as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = maskSecretsDeep(v);
		}
		return out as unknown as T;
	}
	return value;
}

function splitJoinReplace(
	input: string,
	needle: string,
	replacement: string,
): string {
	return input.split(needle).join(replacement);
}
