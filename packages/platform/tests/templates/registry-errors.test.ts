import type { Dirent } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mkDirent = (name: string): Dirent =>
	({
		name,
		isDirectory: () => true,
		isFile: () => false,
		isSymbolicLink: () => false,
	}) as Dirent;

vi.mock("node:fs", async () => {
	const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
	return {
		...actual,
		readdirSync: vi.fn(),
		readFileSync: vi.fn(),
		existsSync: vi.fn(),
	};
});

describe("platform template registry — error branches", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.resetModules();
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("warns and skips templates whose manifest is missing required fields", async () => {
		const { readdirSync, readFileSync, existsSync } = await import("node:fs");
		vi.mocked(readdirSync).mockReturnValue([mkDirent("bad")] as never);
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockReturnValue(
			JSON.stringify({ name: "bad" /* missing fields */ }),
		);

		const { getPlatformTemplates, clearPlatformTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearPlatformTemplatesCache();
		const templates = getPlatformTemplates();

		expect(templates.map((t) => t.name)).not.toContain("bad");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("missing required fields"),
		);
	});

	it("warns and skips templates with malformed JSON", async () => {
		const { readdirSync, readFileSync, existsSync } = await import("node:fs");
		vi.mocked(readdirSync).mockReturnValue([mkDirent("broken")] as never);
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockReturnValue("{ not json");

		const { getPlatformTemplates, clearPlatformTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearPlatformTemplatesCache();
		const templates = getPlatformTemplates();

		expect(templates.map((t) => t.name)).not.toContain("broken");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("malformed template manifest"),
			expect.any(Error),
		);
	});

	it("skips non-directory entries and missing manifest files", async () => {
		const { readdirSync, existsSync } = await import("node:fs");
		const nonDir = {
			name: "readme.md",
			isDirectory: () => false,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as Dirent;
		vi.mocked(readdirSync).mockReturnValue([
			nonDir,
			mkDirent("no-manifest"),
		] as never);
		vi.mocked(existsSync).mockReturnValue(false);

		const { getPlatformTemplates, clearPlatformTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearPlatformTemplatesCache();
		const templates = getPlatformTemplates();

		expect(templates).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
