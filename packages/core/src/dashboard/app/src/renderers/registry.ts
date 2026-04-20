import type { ComponentType } from "react";
import { AdrRenderer } from "./AdrRenderer";
import { ChecklistRenderer } from "./ChecklistRenderer";
import { DocumentRenderer } from "./DocumentRenderer";
import { ErdRenderer } from "./ErdRenderer";
import { SprintPlanRenderer } from "./SprintPlanRenderer";
import { ThreatModelRenderer } from "./ThreatModelRenderer";

export type RendererProps = {
	data: Record<string, unknown>;
	filename: string;
};

const registry = new Map<string, ComponentType<RendererProps>>([
	["sprint-plan.json", SprintPlanRenderer],
	["threat-model.json", ThreatModelRenderer],
	["vulnerability-scan.json", ThreatModelRenderer],
	["dod-checklist.json", ChecklistRenderer],
	["release-readiness.json", ChecklistRenderer],
	["erd.json", ErdRenderer],
	["adrs.json", AdrRenderer],
]);

/**
 * Resolve an artifact filename to the best renderer component.
 * Falls back to DocumentRenderer for unknown types.
 */
export function getRenderer(filename: string): ComponentType<RendererProps> {
	const base = filename.split("/").pop() ?? filename;
	return registry.get(base) ?? DocumentRenderer;
}

export { DocumentRenderer };
