/**
 * Lazy, fail-friendly loader for the native `better-sqlite3` binding.
 *
 * better-sqlite3 loads its compiled `.node` addon at require time. When npm
 * skips a dependency's install scripts — the default since npm 11, which gates
 * lifecycle scripts behind `npm approve-scripts` — the addon is never built and
 * the require throws a cryptic "Could not locate the bindings file" error.
 *
 * We translate that low-level failure into an actionable message pointing the
 * user at the fix, while leaving unrelated errors untouched.
 */

import { createRequire } from "node:module";
import type BetterSqlite3 from "better-sqlite3";

const require = createRequire(import.meta.url);

type DatabaseConstructor = typeof BetterSqlite3;

/** A `require`-shaped function, injectable so the failure path is testable. */
type RequireFn = (id: string) => unknown;

const BINDING_FAILURE_PATTERNS: ReadonlyArray<RegExp> = [
	/could not locate the bindings file/i,
	/better_sqlite3\.node/i,
	/did not self-register/i,
	/NODE_MODULE_VERSION/i,
	/compiled against a different/i,
	/dlopen/i,
];

const BINDING_FAILURE_CODES: ReadonlySet<string> = new Set([
	"ERR_DLOPEN_FAILED",
]);

/**
 * If `err` looks like a native `better-sqlite3` binding-load failure, return an
 * actionable message explaining the npm 11 install-script fix. Otherwise return
 * `null` so the original error can propagate unchanged.
 */
export function nativeBindingErrorMessage(err: unknown): string | null {
	const message = err instanceof Error ? err.message : String(err ?? "");
	const code =
		err && typeof err === "object" && "code" in err
			? String((err as { code: unknown }).code)
			: undefined;

	const isBindingFailure =
		(code !== undefined && BINDING_FAILURE_CODES.has(code)) ||
		BINDING_FAILURE_PATTERNS.some((re) => re.test(message));

	if (!isBindingFailure) return null;

	return [
		"Failed to load the native better-sqlite3 binding.",
		"",
		"This usually means npm did not run its install/build script — npm 11+",
		"blocks dependency install scripts by default. Approve and rebuild it:",
		"",
		"  npm approve-scripts better-sqlite3 koffi",
		"  npm rebuild",
		"",
		`Original error: ${message}`,
	].join("\n");
}

/**
 * Load the `better-sqlite3` Database constructor, translating a native
 * binding-load failure into an actionable error. `requireFn` is injectable for
 * tests; production callers use the default module `require`.
 */
export function loadBetterSqlite(
	requireFn: RequireFn = require,
): DatabaseConstructor {
	try {
		return requireFn("better-sqlite3") as DatabaseConstructor;
	} catch (err) {
		const friendly = nativeBindingErrorMessage(err);
		if (friendly) throw new Error(friendly, { cause: err });
		throw err;
	}
}
