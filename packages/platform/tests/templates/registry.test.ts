import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearPlatformTemplatesCache,
	getPlatformTemplatePath,
	getPlatformTemplates,
} from "../../src/templates/registry.js";

describe("platform template registry", () => {
	beforeEach(() => {
		clearPlatformTemplatesCache();
	});

	afterEach(() => {
		clearPlatformTemplatesCache();
	});

	it("lists bundled platform templates", () => {
		const templates = getPlatformTemplates();
		const names = templates.map((t) => t.name);
		expect(names).toContain("api-builder");
		expect(names).toContain("code-review");
		expect(names).toContain("content-generation");
		expect(names).toContain("data-pipeline");
		expect(names).toContain("seo-review");
	});

	it("each template has required manifest fields and a path that exists", () => {
		for (const t of getPlatformTemplates()) {
			expect(t.displayName).toBeTruthy();
			expect(t.description).toBeTruthy();
			expect(Array.isArray(t.tags)).toBe(true);
			expect(t.agents).toBeGreaterThan(0);
			expect(t.executor).toBeTruthy();
			expect(existsSync(t.path)).toBe(true);
		}
	});

	it("getPlatformTemplatePath returns the matching directory", () => {
		const path = getPlatformTemplatePath("api-builder");
		expect(path).toBeTruthy();
		expect(existsSync(path ?? "")).toBe(true);
	});

	it("getPlatformTemplatePath returns null for unknown template", () => {
		expect(getPlatformTemplatePath("nonexistent-xyz")).toBeNull();
	});

	it("caches results across calls", () => {
		const first = getPlatformTemplates();
		const second = getPlatformTemplates();
		expect(second).toBe(first);
	});

	it("clearPlatformTemplatesCache forces re-scan", () => {
		const first = getPlatformTemplates();
		clearPlatformTemplatesCache();
		const second = getPlatformTemplates();
		// Same content but different array instance
		expect(second).not.toBe(first);
		expect(second.map((t) => t.name).sort()).toEqual(
			first.map((t) => t.name).sort(),
		);
	});
});
