/**
 * Tests for LocalLeaderElector — single-process default (P45-T5).
 * Always leader. Used in single-replica or non-Postgres deployments.
 */
import { describe, expect, it } from "vitest";
import { LocalLeaderElector } from "../../../src/adapters/leader/local-leader-elector.js";

describe("LocalLeaderElector", () => {
	it("acquire always returns true", async () => {
		const e = new LocalLeaderElector();
		expect(await e.acquire("foo")).toBe(true);
	});

	it("isLeader is true after acquire", async () => {
		const e = new LocalLeaderElector();
		await e.acquire("foo");
		expect(e.isLeader("foo")).toBe(true);
	});

	it("isLeader is false before any acquire call", () => {
		const e = new LocalLeaderElector();
		expect(e.isLeader("foo")).toBe(false);
	});

	it("release flips isLeader back to false", async () => {
		const e = new LocalLeaderElector();
		await e.acquire("foo");
		await e.release("foo");
		expect(e.isLeader("foo")).toBe(false);
	});

	it("isolates locks by name", async () => {
		const e = new LocalLeaderElector();
		await e.acquire("a");
		expect(e.isLeader("a")).toBe(true);
		expect(e.isLeader("b")).toBe(false);
	});
});
