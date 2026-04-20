/**
 * Template registry — discovers and exposes bundled AgentForge templates.
 * Platform extends this by merging its own templates at runtime.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TemplateManifest {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly tags: string[];
	readonly agents: number;
	readonly executor: string;
	readonly path: string;
}

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

let cachedCoreTemplates: TemplateManifest[] | null = null;

const BLANK_MANIFEST: TemplateManifest = {
	name: "blank",
	displayName: "Blank",
	description:
		"Empty scaffold — one example agent, pipeline, schema, and prompt to get started",
	tags: ["starter"],
	agents: 1,
	executor: "pi-ai",
	path: "",
};

/** Returns all templates bundled in agentforge-core (cached after first call). */
export function getCoreTemplates(): TemplateManifest[] {
	if (cachedCoreTemplates) return cachedCoreTemplates;

	const templates: TemplateManifest[] = [BLANK_MANIFEST];

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

	cachedCoreTemplates = templates;
	return templates;
}

/** Invalidate the cached core template list (primarily for tests). */
export function clearCoreTemplatesCache(): void {
	cachedCoreTemplates = null;
}

/** Returns the absolute path to a template directory, or null if not found. */
export function getTemplatePath(name: string): string | null {
	if (name === "blank") return null;
	return getCoreTemplates().find((t) => t.name === name)?.path ?? null;
}
