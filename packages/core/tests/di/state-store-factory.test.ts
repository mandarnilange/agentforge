import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createStateStore } from "../../src/di/state-store-factory.js";
import { SqliteStateStore } from "../../src/state/store.js";

const TEST_DB = "/tmp/sdlc-factory-test.db";

describe("createStateStore", () => {
	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("creates SQLite store", () => {
		const store = createStateStore({ sqlitePath: TEST_DB });
		expect(store).toBeInstanceOf(SqliteStateStore);
		store.close();
	});
});
