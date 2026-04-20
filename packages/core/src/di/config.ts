/**
 * AppConfig — application configuration with layered loading:
 * defaults -> config file -> env vars -> CLI overrides
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { registerSecret } from "../adapters/secrets/secret-registry.js";
import { resolveAgentforgeDir } from "./agentforge-dir.js";

// Prompts live alongside other .agentforge configuration, not in source code.
function defaultPromptsDir(): string {
	return join(resolveAgentforgeDir(), "prompts");
}

export interface AppConfig {
	llm: {
		provider: "anthropic";
		model: string;
		apiKey: string;
		maxTokens: number;
		/**
		 * Wall-clock timeout per LLM call in seconds. Applied as an AbortSignal
		 * that wraps the user-supplied signal. Set to 0 or a negative value to
		 * disable. Default: 600 (10 minutes). Override via
		 * AGENTFORGE_LLM_TIMEOUT_SECONDS env var.
		 */
		timeoutSeconds: number;
	};
	outputDir: string;
	promptsDir: string;
	logLevel: string;
}

interface ConfigFileContent {
	llm?: Partial<AppConfig["llm"]>;
	outputDir?: string;
	promptsDir?: string;
	logLevel?: string;
}

export interface ConfigOverrides extends Partial<AppConfig> {
	configFilePath?: string;
}

function loadConfigFile(filePath: string): ConfigFileContent {
	if (!existsSync(filePath)) {
		return {};
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content) as ConfigFileContent;
	} catch (err) {
		throw new Error(
			`Failed to load config file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

function findDefaultConfigFile(): string | undefined {
	const candidates = [resolve("agentforge.config.json")];
	return candidates.find((c) => existsSync(c));
}

export function loadConfig(overrides?: ConfigOverrides): AppConfig {
	// Load .env file if present (won't override existing env vars)
	loadDotenv();

	// Layer 1: Defaults
	const defaults: AppConfig = {
		llm: {
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
			apiKey: "",
			maxTokens: 64000,
			timeoutSeconds: 600,
		},
		outputDir: resolve("output"),
		promptsDir: defaultPromptsDir(),
		logLevel: "info",
	};

	// Layer 2: Config file
	const configFilePath = overrides?.configFilePath ?? findDefaultConfigFile();
	const fileConfig = configFilePath ? loadConfigFile(configFilePath) : {};

	// Apply config file values over defaults
	const afterFile: AppConfig = {
		llm: {
			provider: "anthropic",
			model: fileConfig.llm?.model ?? defaults.llm.model,
			apiKey: fileConfig.llm?.apiKey ?? defaults.llm.apiKey,
			maxTokens: fileConfig.llm?.maxTokens ?? defaults.llm.maxTokens,
			timeoutSeconds:
				fileConfig.llm?.timeoutSeconds ?? defaults.llm.timeoutSeconds,
		},
		outputDir: fileConfig.outputDir ?? defaults.outputDir,
		promptsDir: fileConfig.promptsDir ?? defaults.promptsDir,
		logLevel: fileConfig.logLevel ?? defaults.logLevel,
	};

	// Layer 3: Environment variables (override config file)
	const envApiKey = process.env.ANTHROPIC_API_KEY;
	const afterEnv: AppConfig = {
		llm: {
			provider: "anthropic",
			model: process.env.AGENTFORGE_DEFAULT_MODEL ?? afterFile.llm.model,
			apiKey: envApiKey ?? afterFile.llm.apiKey,
			maxTokens: process.env.AGENTFORGE_MAX_TOKENS
				? Number(process.env.AGENTFORGE_MAX_TOKENS)
				: afterFile.llm.maxTokens,
			timeoutSeconds: (() => {
				const raw = process.env.AGENTFORGE_LLM_TIMEOUT_SECONDS;
				if (!raw) return afterFile.llm.timeoutSeconds;
				const parsed = Number(raw);
				if (!Number.isFinite(parsed)) {
					throw new Error(
						"AGENTFORGE_LLM_TIMEOUT_SECONDS must be a number (in seconds).",
					);
				}
				return parsed;
			})(),
		},
		outputDir: process.env.AGENTFORGE_OUTPUT_DIR ?? afterFile.outputDir,
		promptsDir: process.env.AGENTFORGE_PROMPTS_DIR ?? afterFile.promptsDir,
		logLevel: process.env.AGENTFORGE_LOG_LEVEL ?? afterFile.logLevel,
	};

	// Layer 4: CLI overrides (highest precedence)
	if (overrides?.llm) {
		afterEnv.llm = { ...afterEnv.llm, ...overrides.llm };
	}
	if (overrides?.outputDir !== undefined) {
		afterEnv.outputDir = overrides.outputDir;
	}
	if (overrides?.promptsDir !== undefined) {
		afterEnv.promptsDir = overrides.promptsDir;
	}
	if (overrides?.logLevel !== undefined) {
		afterEnv.logLevel = overrides.logLevel;
	}

	// Validate required fields
	if (!afterEnv.llm.apiKey) {
		const err = new Error(
			"ANTHROPIC_API_KEY is required. Set it in your environment or .env file before running agentforge.\n" +
				"  export ANTHROPIC_API_KEY=sk-ant-...\n" +
				"  # or add ANTHROPIC_API_KEY=sk-ant-... to .env in your project root\n" +
				"Get a key at https://console.anthropic.com/settings/keys",
		);
		(err as Error & { code?: string }).code = "MISSING_API_KEY";
		throw err;
	}
	// Register known-sensitive values so subsequent log output masks them.
	// Covers ANTHROPIC_API_KEY and any provider keys we happen to see in env.
	registerSecret(afterEnv.llm.apiKey);
	for (const name of [
		"OPENAI_API_KEY",
		"GOOGLE_API_KEY",
		"ANTHROPIC_AUTH_TOKEN",
		"AGENTFORGE_POSTGRES_URL",
	]) {
		registerSecret(process.env[name]);
	}

	return afterEnv;
}
