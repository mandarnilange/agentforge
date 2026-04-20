/**
 * Smoke tests for npm publish readiness.
 *
 * Validates that package.json metadata, build entry points, and key exports
 * are correctly configured for `npm publish`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "../../");
const pkg = JSON.parse(
	readFileSync(join(PKG_ROOT, "package.json"), "utf-8"),
) as Record<string, unknown>;

describe("agentforge-core publish readiness", () => {
	describe("package.json metadata", () => {
		it("has unscoped package name", () => {
			expect(pkg.name).toBe("agentforge-core");
		});

		it("has a version", () => {
			expect(typeof pkg.version).toBe("string");
			expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
		});

		it("has a description", () => {
			expect(typeof pkg.description).toBe("string");
			expect((pkg.description as string).length).toBeGreaterThan(10);
		});

		it("has license", () => {
			expect(pkg.license).toBe("MIT");
		});

		it("has repository", () => {
			expect(pkg.repository).toBeDefined();
		});

		it("has engines >= 20", () => {
			const engines = pkg.engines as { node: string };
			expect(engines.node).toMatch(/>=\s*20/);
		});

		it("has public publishConfig", () => {
			const pc = pkg.publishConfig as { access: string };
			expect(pc.access).toBe("public");
		});

		it("has files field limiting to dist", () => {
			const files = pkg.files as string[];
			expect(files).toContain("dist");
		});

		it("has keywords", () => {
			const keywords = pkg.keywords as string[];
			expect(keywords.length).toBeGreaterThan(0);
			expect(keywords).toContain("ai");
		});
	});

	describe("bin entry point", () => {
		it("declares agentforge-core bin", () => {
			const bin = pkg.bin as Record<string, string>;
			expect(bin["agentforge-core"]).toBe("./dist/cli/index.js");
		});

		it("bin target exists in source", () => {
			expect(existsSync(join(PKG_ROOT, "src/cli/index.ts"))).toBe(true);
		});
	});

	describe("exports", () => {
		it("has root export", () => {
			const exports = pkg.exports as Record<string, unknown>;
			expect(exports["."]).toBeDefined();
		});

		it("has domain subpath exports", () => {
			const exports = pkg.exports as Record<string, unknown>;
			expect(exports["./domain/*"]).toBeDefined();
		});

		it("has di subpath exports", () => {
			const exports = pkg.exports as Record<string, unknown>;
			expect(exports["./di/*"]).toBeDefined();
		});

		it("root export source file exists", () => {
			expect(existsSync(join(PKG_ROOT, "src/agents/index.ts"))).toBe(true);
		});
	});

	describe("key source files exist", () => {
		const requiredFiles = [
			"src/cli/index.ts",
			"src/di/config.ts",
			"src/di/container.ts",
			"src/domain/ports/execution-backend.port.ts",
			"src/domain/ports/state-store.port.ts",
			"src/state/store.ts",
			"src/agents/registry.ts",
			"src/agents/runner.ts",
			"src/engine/step-pipeline.ts",
		];

		for (const file of requiredFiles) {
			it(`${file} exists`, () => {
				expect(existsSync(join(PKG_ROOT, file))).toBe(true);
			});
		}
	});

	describe("build scripts", () => {
		it("has build script", () => {
			const scripts = pkg.scripts as Record<string, string>;
			expect(scripts.build).toBeDefined();
		});

		it("has prepublishOnly hook", () => {
			const scripts = pkg.scripts as Record<string, string>;
			expect(scripts.prepublishOnly).toBeDefined();
		});

		it("delegates build to the monorepo root (which handles SPA + asset copy)", () => {
			const scripts = pkg.scripts as Record<string, string>;
			expect(scripts.build).toMatch(/--prefix \.\.\/\.\./);
			expect(scripts.prepublishOnly).toMatch(/--prefix \.\.\/\.\./);
		});
	});
});
