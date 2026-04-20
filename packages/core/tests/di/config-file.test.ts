import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/di/config.js";

describe("Config file system", () => {
	let tmpDir: string;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = join(tmpdir(), `sdlc-config-test-${Date.now()}`);
		mkdirSync(tmpDir, { recursive: true });
		process.env.ANTHROPIC_API_KEY = "test-key-for-config-tests";
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		process.env = { ...originalEnv };
	});

	it("loads config from a JSON config file", () => {
		const configPath = join(tmpDir, "agentforge.config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				llm: { model: "claude-opus-4-20250514" },
				outputDir: "/custom/output",
				logLevel: "debug",
			}),
		);

		const config = loadConfig({ configFilePath: configPath });
		expect(config.llm.provider).toBe("anthropic");
		expect(config.llm.model).toBe("claude-opus-4-20250514");
		expect(config.outputDir).toBe("/custom/output");
		expect(config.logLevel).toBe("debug");
	});

	it("env vars override config file values", () => {
		const configPath = join(tmpDir, "agentforge.config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				llm: { model: "claude-opus-4-20250514" },
				logLevel: "debug",
			}),
		);

		process.env.AGENTFORGE_LOG_LEVEL = "error";

		const config = loadConfig({ configFilePath: configPath });
		expect(config.logLevel).toBe("error");
		expect(config.llm.model).toBe("claude-opus-4-20250514");
		expect(config.llm.provider).toBe("anthropic");
	});

	it("CLI overrides take precedence over everything", () => {
		const configPath = join(tmpDir, "agentforge.config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				llm: { model: "claude-opus-4-20250514" },
				logLevel: "debug",
			}),
		);

		const config = loadConfig({
			configFilePath: configPath,
			llm: {
				provider: "anthropic",
				model: "claude-haiku-4-5-20251001",
				apiKey: "key",
				maxTokens: 8000,
			},
			logLevel: "warn",
		});

		expect(config.llm.model).toBe("claude-haiku-4-5-20251001");
		expect(config.logLevel).toBe("warn");
	});

	it("returns defaults when no config file exists", () => {
		const config = loadConfig({
			configFilePath: join(tmpDir, "nonexistent.json"),
		});
		expect(config.llm.provider).toBe("anthropic");
		expect(config.logLevel).toBe(process.env.AGENTFORGE_LOG_LEVEL ?? "info");
	});

	it("handles malformed config file gracefully", () => {
		const configPath = join(tmpDir, "agentforge.config.json");
		writeFileSync(configPath, "not valid json{{{");

		expect(() => loadConfig({ configFilePath: configPath })).toThrow(
			/Failed to load config file/,
		);
	});

	it("supports partial config file (only some fields)", () => {
		const configPath = join(tmpDir, "agentforge.config.json");
		writeFileSync(
			configPath,
			JSON.stringify({
				logLevel: "trace",
			}),
		);

		const config = loadConfig({ configFilePath: configPath });
		expect(config.logLevel).toBe("trace");
		expect(config.llm.provider).toBe("anthropic");
	});

	it("CLI override for outputDir takes precedence", () => {
		const config = loadConfig({ outputDir: "/cli/override/output" });
		expect(config.outputDir).toBe("/cli/override/output");
	});

	it("CLI override for promptsDir takes precedence", () => {
		const config = loadConfig({ promptsDir: "/cli/override/prompts" });
		expect(config.promptsDir).toBe("/cli/override/prompts");
	});
});
