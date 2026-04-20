import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CoreApp, createCoreApp } from "../../src/di/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/di/ → packages/core → repo root (3 parents up) → .agentforge
const REPO_AGENTFORGE_DIR = join(__dirname, "../../../../.agentforge");

describe("createCoreApp", () => {
	let tmpDir: string;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let app: CoreApp | undefined;
	const originalEnv = { ...process.env };

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "agentforge-app-test-"));
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		app = undefined;
	});

	afterEach(() => {
		// Close even if an assertion threw earlier so the SQLite handle doesn't leak
		app?.stateStore.close();
		app = undefined;
		vi.restoreAllMocks();
		process.env = { ...originalEnv };
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("wires all core services with an empty definitions dir", async () => {
		app = await createCoreApp({
			outputDir: join(tmpDir, "out"),
			agentforgeDir: join(tmpDir, "defs"),
			stateDbPath: join(tmpDir, "state.db"),
		});

		expect(app.stateStore).toBeDefined();
		expect(app.gateController).toBeDefined();
		expect(app.scheduler).toBeDefined();
		expect(app.pipelineController).toBeDefined();
		expect(app.definitionStore).toBeDefined();
		expect(app.eventBus).toBeDefined();
		expect(app.outputDir).toBe(join(tmpDir, "out"));
	});

	it("warns when no agents or pipelines are found", async () => {
		app = await createCoreApp({
			outputDir: join(tmpDir, "out"),
			agentforgeDir: join(tmpDir, "defs"),
			stateDbPath: join(tmpDir, "state.db"),
		});

		const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
		expect(warnMessages.some((m) => m.includes("No agents found"))).toBe(true);
		expect(warnMessages.some((m) => m.includes("No pipelines found"))).toBe(
			true,
		);
	});

	it("builds an executor when ANTHROPIC_API_KEY is set", async () => {
		process.env.ANTHROPIC_API_KEY = "sk-test-fake-key";
		app = await createCoreApp({
			outputDir: join(tmpDir, "out"),
			agentforgeDir: join(tmpDir, "defs"),
			stateDbPath: join(tmpDir, "state.db"),
		});

		expect(app.appConfig).toBeDefined();
		expect(app.agentExecutor).toBeDefined();
	});

	it("honors AGENTFORGE_OUTPUT_DIR env var when outputDir option omitted", async () => {
		const envOutputDir = join(tmpDir, "env-output");
		process.env.AGENTFORGE_OUTPUT_DIR = envOutputDir;

		app = await createCoreApp({
			agentforgeDir: join(tmpDir, "defs"),
			stateDbPath: join(tmpDir, "state.db"),
		});

		expect(app.outputDir).toBe(envOutputDir);
	});

	it("loads agents and pipelines when the definitions dir contains them", async () => {
		// Resolve .agentforge via the test file's own path so CI working-dir doesn't matter
		app = await createCoreApp({
			outputDir: join(tmpDir, "out"),
			agentforgeDir: REPO_AGENTFORGE_DIR,
			stateDbPath: join(tmpDir, "state.db"),
		});

		expect(app.definitionStore.listAgents().length).toBeGreaterThan(0);
		expect(app.definitionStore.listPipelines().length).toBeGreaterThan(0);
	});
});
