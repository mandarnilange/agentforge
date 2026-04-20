import { describe, expect, it } from "vitest";
import { getAgentInfo } from "../../src/agents/registry.js";

describe("agent info", () => {
	it("returns detailed info for a valid agent", () => {
		const info = getAgentInfo("analyst");
		expect(info).toBeDefined();
		expect(info?.id).toBe("analyst");
		expect(info?.displayName).toBeTruthy();
		expect(info?.description).toBeTruthy();
		expect(info?.outputs).toBeInstanceOf(Array);
		expect(info?.outputs.length).toBeGreaterThan(0);
	});

	it("returns undefined for unknown agent", () => {
		const info = getAgentInfo("unknown-agent");
		expect(info).toBeUndefined();
	});

	it("developer uses pi-coding-agent executor", () => {
		const info = getAgentInfo("developer");
		expect(info?.executor).toBe("pi-coding-agent");
	});

	it("analyst uses pi-ai executor", () => {
		const info = getAgentInfo("analyst");
		expect(info?.executor).toBe("pi-ai");
	});

	it("each agent has inputs and outputs defined", () => {
		for (const name of ["analyst", "architect", "developer"]) {
			const info = getAgentInfo(name);
			expect(info, `${name} should exist`).toBeDefined();
			expect(
				info?.outputs.length,
				`${name} should have outputs`,
			).toBeGreaterThan(0);
		}
	});
});
