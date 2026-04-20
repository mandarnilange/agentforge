import { describe, expect, it } from "vitest";
import type { AgentInfo, AgentSummary } from "../../src/agents/registry.js";
import { formatAgentInfo, formatAgentTable } from "../../src/cli/formatter.js";

const mockSummary: AgentSummary[] = [
	{
		id: "analyst",
		displayName: "Analyst",
		phase: "1",
		role: "Business Analyst",
		executor: "pi-ai",
		humanEquivalent: "BA",
	},
	{
		id: "architect",
		displayName: "Architect",
		phase: "2",
		role: "Architect",
		executor: "pi-ai",
		humanEquivalent: "Architect",
	},
];

const mockInfo: AgentInfo = {
	id: "analyst",
	displayName: "Analyst",
	phase: "1",
	role: "Business Analyst",
	executor: "pi-ai",
	humanEquivalent: "Business Analyst",
	description: "Clarifies requirements and produces FRD.",
	inputs: ["raw-input"],
	outputs: ["frd"],
	tools: [],
};

describe("formatAgentTable", () => {
	it("includes header with Agent, Phase, Role columns", () => {
		const result = formatAgentTable(mockSummary);
		expect(result).toContain("Agent");
		expect(result).toContain("Phase");
		expect(result).toContain("Role");
	});

	it("includes each agent in the table", () => {
		const result = formatAgentTable(mockSummary);
		expect(result).toContain("Analyst");
		expect(result).toContain("Architect");
	});

	it("includes phase numbers", () => {
		const result = formatAgentTable(mockSummary);
		expect(result).toContain("1");
		expect(result).toContain("2");
	});

	it("includes roles", () => {
		const result = formatAgentTable(mockSummary);
		expect(result).toContain("Business Analyst");
		expect(result).toContain("Architect");
	});
});

describe("formatAgentInfo", () => {
	it("includes agent display name", () => {
		const result = formatAgentInfo(mockInfo);
		expect(result).toContain("Analyst");
	});

	it("includes executor type", () => {
		const result = formatAgentInfo(mockInfo);
		expect(result).toContain("pi-ai");
	});

	it("includes inputs and outputs", () => {
		const result = formatAgentInfo(mockInfo);
		expect(result).toContain("raw-input");
		expect(result).toContain("frd");
	});

	it("includes description", () => {
		const result = formatAgentInfo(mockInfo);
		expect(result).toContain("Clarifies requirements");
	});

	it("includes tools when non-empty", () => {
		const infoWithTools: AgentInfo = {
			...mockInfo,
			tools: ["bash", "grep"],
		};
		const result = formatAgentInfo(infoWithTools);
		expect(result).toContain("bash");
		expect(result).toContain("grep");
	});

	it("omits tools line when tools is empty", () => {
		const result = formatAgentInfo(mockInfo);
		expect(result).not.toContain("Tools:");
	});
});
