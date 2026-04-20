import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/di/config.js";

describe("Config validation (P40-T1, P42)", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		// Set API key to empty string (not delete) so dotenv won't re-populate from .env
		process.env = { ...originalEnv };
		process.env.ANTHROPIC_API_KEY = "";
		delete process.env.AGENTFORGE_LLM_TIMEOUT_SECONDS;
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("throws with MISSING_API_KEY code when ANTHROPIC_API_KEY absent", () => {
		try {
			loadConfig();
			throw new Error("expected to throw");
		} catch (err) {
			const e = err as Error & { code?: string };
			expect(e.code).toBe("MISSING_API_KEY");
			expect(e.message).toContain("ANTHROPIC_API_KEY is required");
			expect(e.message).toContain("console.anthropic.com");
		}
	});

	it("accepts AGENTFORGE_LLM_TIMEOUT_SECONDS=0 to disable timeout", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test";
		process.env.AGENTFORGE_LLM_TIMEOUT_SECONDS = "0";
		const cfg = loadConfig();
		expect(cfg.llm.timeoutSeconds).toBe(0);
	});

	it("reads AGENTFORGE_LLM_TIMEOUT_SECONDS from env", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test";
		process.env.AGENTFORGE_LLM_TIMEOUT_SECONDS = "30";
		const cfg = loadConfig();
		expect(cfg.llm.timeoutSeconds).toBe(30);
	});

	it("defaults timeoutSeconds to 600", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test";
		const cfg = loadConfig();
		expect(cfg.llm.timeoutSeconds).toBe(600);
	});

	it("rejects non-numeric timeout", () => {
		process.env.ANTHROPIC_API_KEY = "sk-test";
		process.env.AGENTFORGE_LLM_TIMEOUT_SECONDS = "ten seconds";
		expect(() => loadConfig()).toThrow(/must be a number/);
	});
});
