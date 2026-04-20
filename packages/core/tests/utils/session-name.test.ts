import { describe, expect, it } from "vitest";
import { generateSessionName } from "../../src/utils/session-name.js";

describe("generateSessionName", () => {
	it("returns a string in adjective-noun format", () => {
		const name = generateSessionName();
		expect(name).toMatch(/^[a-z]+-[a-z]+$/);
	});

	it("generates unique names across multiple calls", () => {
		const names = new Set<string>();
		for (let i = 0; i < 50; i++) {
			names.add(generateSessionName());
		}
		// With random selection from large word lists, collisions in 50 calls are very unlikely
		expect(names.size).toBeGreaterThan(40);
	});

	it("produces filesystem-safe names (no spaces, special chars)", () => {
		for (let i = 0; i < 20; i++) {
			const name = generateSessionName();
			expect(name).toMatch(/^[a-z-]+$/);
			expect(name.length).toBeLessThan(40);
		}
	});
});
