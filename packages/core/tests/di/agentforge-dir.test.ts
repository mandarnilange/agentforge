import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAgentforgeDir } from "../../src/di/agentforge-dir.js";

describe("resolveAgentforgeDir", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns override when provided", () => {
		process.env.AGENTFORGE_DIR = "/from-env";
		expect(resolveAgentforgeDir("/explicit")).toBe("/explicit");
	});

	it("returns AGENTFORGE_DIR env var when no override is given", () => {
		process.env.AGENTFORGE_DIR = "/from-env";
		expect(resolveAgentforgeDir()).toBe("/from-env");
	});

	it("returns cwd/.agentforge when neither override nor env var is set", () => {
		delete process.env.AGENTFORGE_DIR;
		expect(resolveAgentforgeDir()).toBe(join(process.cwd(), ".agentforge"));
	});

	it("override takes precedence over env var", () => {
		process.env.AGENTFORGE_DIR = "/env-value";
		expect(resolveAgentforgeDir("/override-value")).toBe("/override-value");
	});
});
