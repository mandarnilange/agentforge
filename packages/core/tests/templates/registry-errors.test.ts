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

describe("core template registry — error branches", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		// Reset module cache so the registry re-runs with fresh mocks
		vi.resetModules();
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("warns and skips templates whose manifest is missing required fields", async () => {
		const { readdirSync, readFileSync, existsSync } = await import("node:fs");
		vi.mocked(readdirSync).mockReturnValue([mkDirent("bad-template")] as never);
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockReturnValue(
			JSON.stringify({ name: "bad-template" /* missing fields */ }),
		);

		const { getCoreTemplates, clearCoreTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearCoreTemplatesCache();
		const templates = getCoreTemplates();

		// blank is always included; the bad one is skipped
		expect(templates.map((t) => t.name)).toContain("blank");
		expect(templates.map((t) => t.name)).not.toContain("bad-template");
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("missing required fields"),
		);
	});

	it("warns and skips templates with malformed JSON", async () => {
		const { readdirSync, readFileSync, existsSync } = await import("node:fs");
		vi.mocked(readdirSync).mockReturnValue([mkDirent("broken-json")] as never);
		vi.mocked(existsSync).mockReturnValue(true);
		vi.mocked(readFileSync).mockReturnValue("{ not valid json");

		const { getCoreTemplates, clearCoreTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearCoreTemplatesCache();
		const templates = getCoreTemplates();

		expect(templates.map((t) => t.name)).toContain("blank");
		expect(templates.map((t) => t.name)).not.toContain("broken-json");
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

		const { getCoreTemplates, clearCoreTemplatesCache } = await import(
			"../../src/templates/registry.js"
		);
		clearCoreTemplatesCache();
		const templates = getCoreTemplates();

		expect(templates.map((t) => t.name)).toEqual(["blank"]);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
