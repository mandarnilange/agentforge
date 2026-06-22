import { describe, expect, it } from "vitest";
import {
	loadBetterSqlite,
	nativeBindingErrorMessage,
} from "../../src/state/native-sqlite.js";

describe("nativeBindingErrorMessage", () => {
	it("returns guidance for a missing bindings file (install script not run)", () => {
		const err = new Error(
			"Could not locate the bindings file. Tried:\n → .../better_sqlite3.node",
		);
		const msg = nativeBindingErrorMessage(err);
		expect(msg).not.toBeNull();
		expect(msg).toContain("npm approve-scripts better-sqlite3");
		expect(msg).toContain("npm rebuild");
	});

	it("returns guidance for an ERR_DLOPEN_FAILED error", () => {
		const err = Object.assign(new Error("dlopen failed"), {
			code: "ERR_DLOPEN_FAILED",
		});
		expect(nativeBindingErrorMessage(err)).toContain(
			"npm approve-scripts better-sqlite3",
		);
	});

	it("returns guidance for a NODE_MODULE_VERSION mismatch", () => {
		const err = new Error(
			"The module was compiled against a different Node.js version using NODE_MODULE_VERSION 120.",
		);
		expect(nativeBindingErrorMessage(err)).not.toBeNull();
	});

	it("references the better_sqlite3.node addon by name in the message", () => {
		const err = new Error("Could not locate the bindings file");
		expect(nativeBindingErrorMessage(err)).toContain("better-sqlite3");
	});

	it("returns null for unrelated errors so they propagate untouched", () => {
		expect(nativeBindingErrorMessage(new Error("disk is full"))).toBeNull();
		expect(nativeBindingErrorMessage(new TypeError("bad arg"))).toBeNull();
	});

	it("tolerates non-Error values", () => {
		expect(nativeBindingErrorMessage("just a string")).toBeNull();
		expect(nativeBindingErrorMessage(undefined)).toBeNull();
	});
});

describe("loadBetterSqlite", () => {
	it("loads the real better-sqlite3 constructor when the binding is present", () => {
		const Database = loadBetterSqlite();
		expect(typeof Database).toBe("function");
		const db = new Database(":memory:");
		expect(db.open).toBe(true);
		db.close();
	});

	it("wraps a binding-load failure with actionable guidance and preserves the cause", () => {
		const original = new Error("Could not locate the bindings file");
		const failingRequire = () => {
			throw original;
		};
		expect(() => loadBetterSqlite(failingRequire)).toThrow(
			/npm approve-scripts better-sqlite3/,
		);
		try {
			loadBetterSqlite(failingRequire);
		} catch (err) {
			expect((err as Error).cause).toBe(original);
		}
	});

	it("rethrows unrelated require failures unchanged", () => {
		const original = new Error("some unrelated failure");
		const failingRequire = () => {
			throw original;
		};
		expect(() => loadBetterSqlite(failingRequire)).toThrow(original);
	});
});
