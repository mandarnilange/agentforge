import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "../../");
const pkg = JSON.parse(
	readFileSync(join(PKG_ROOT, "package.json"), "utf-8"),
) as Record<string, unknown>;

describe("agentforge (platform) publish readiness", () => {
	describe("package.json metadata", () => {
		it("has unscoped package name", () => {
			expect(pkg.name).toBe("agentforge");
		});

		it("has a version", () => {
			expect(typeof pkg.version).toBe("string");
			expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
		});

		it("has license", () => {
			expect(pkg.license).toBe("MIT");
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
	});

	describe("bin entry point", () => {
		it("declares agentforge bin", () => {
			const bin = pkg.bin as Record<string, string>;
			expect(bin.agentforge).toBe("./dist/platform-cli.js");
		});

		it("bin target exists in source", () => {
			expect(existsSync(join(PKG_ROOT, "src/platform-cli.ts"))).toBe(true);
		});
	});

	describe("core dependency", () => {
		it("depends on unscoped agentforge-core", () => {
			const deps = pkg.dependencies as Record<string, string>;
			expect(deps["agentforge-core"]).toBeDefined();
		});

		it("peer-depends on unscoped agentforge-core", () => {
			const peers = pkg.peerDependencies as Record<string, string>;
			expect(peers["agentforge-core"]).toBeDefined();
		});

		it("has no scoped @agentforge/* dependency keys", () => {
			const deps = pkg.dependencies as Record<string, string>;
			const peers = pkg.peerDependencies as Record<string, string>;
			const scoped = [
				...Object.keys(deps ?? {}),
				...Object.keys(peers ?? {}),
			].filter((key) => key.startsWith("@agentforge/"));
			expect(scoped).toEqual([]);
		});
	});
});
