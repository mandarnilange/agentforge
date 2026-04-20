import { describe, expect, it } from "vitest";
import { getAgentList } from "../../src/agents/registry.js";

describe("agent list", () => {
	it("returns the simple-sdlc starter agents", () => {
		const agents = getAgentList();
		expect(agents).toHaveLength(3);
	});

	it("includes analyst, architect, developer", () => {
		const agents = getAgentList();
		const names = agents.map((a) => a.id);
		expect(names).toContain("analyst");
		expect(names).toContain("architect");
		expect(names).toContain("developer");
	});

	it("each agent has required fields", () => {
		const agents = getAgentList();
		for (const agent of agents) {
			expect(agent.id).toBeTruthy();
			expect(agent.displayName).toBeTruthy();
			expect(agent.role).toBeTruthy();
			expect(agent.phase).toBeTruthy();
		}
	});
});
