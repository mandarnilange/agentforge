/**
 * Platform template registry — extends core templates with platform-specific templates.
 * Import getCoreTemplates() from core and merge with getPlatformTemplates() for a full list.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TemplateManifest } from "agentforge-core/templates/registry.js";

export type { TemplateManifest };

const TEMPLATES_DIR = import.meta.dirname;

function isValidManifest(
	value: unknown,
): value is Omit<TemplateManifest, "path"> {
	if (!value || typeof value !== "object") return false;
	const m = value as Record<string, unknown>;
	return (
		typeof m.name === "string" &&
		typeof m.displayName === "string" &&
		typeof m.description === "string" &&
		Array.isArray(m.tags) &&
		typeof m.agents === "number" &&
		typeof m.executor === "string"
	);
}

let cachedPlatformTemplates: TemplateManifest[] | null = null;

/** Returns all templates bundled in agentforge (cached after first call). */
export function getPlatformTemplates(): TemplateManifest[] {
	if (cachedPlatformTemplates) return cachedPlatformTemplates;

	const templates: TemplateManifest[] = [];

	for (const entry of readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = join(TEMPLATES_DIR, entry.name, "template.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const raw = readFileSync(manifestPath, "utf-8");
			const parsed: unknown = JSON.parse(raw);
			if (!isValidManifest(parsed)) {
				console.warn(
					`Skipping template manifest missing required fields: ${manifestPath}`,
				);
				continue;
			}
			templates.push({ ...parsed, path: join(TEMPLATES_DIR, entry.name) });
		} catch (err) {
			console.warn(
				`Skipping malformed template manifest: ${manifestPath}`,
				err,
			);
		}
	}

	cachedPlatformTemplates = templates;
	return templates;
}

/** Invalidate the cached platform template list (primarily for tests). */
export function clearPlatformTemplatesCache(): void {
	cachedPlatformTemplates = null;
}

/** Returns the absolute path to a platform template directory, or null if not found. */
export function getPlatformTemplatePath(name: string): string | null {
	return getPlatformTemplates().find((t) => t.name === name)?.path ?? null;
}
