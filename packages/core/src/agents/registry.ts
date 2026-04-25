import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinitionYaml } from "../definitions/parser.js";
import { parseDefinitionFile } from "../definitions/parser.js";
import { resolveAgentforgeDir } from "../di/agentforge-dir.js";
import { getRuntimeDefinitionStore } from "./definition-source.js";

export interface AgentSummary {
	id: string;
	displayName: string;
	role: string;
	phase: string;
	humanEquivalent: string;
}

export interface AgentInfo extends AgentSummary {
	description: string;
	executor: "pi-ai" | "pi-coding-agent";
	inputs: string[];
	outputs: string[];
	tools: string[];
}

function definitionToInfo(def: AgentDefinitionYaml): AgentInfo {
	return {
		id: def.metadata.name,
		displayName: def.metadata.displayName ?? def.metadata.name,
		role: def.metadata.description ?? def.metadata.role ?? "",
		phase: def.metadata.phase,
		humanEquivalent: def.metadata.humanEquivalent ?? "",
		description: def.metadata.description ?? "",
		executor: def.spec.executor,
		inputs: def.spec.inputs?.map((i) => i.type) ?? [],
		outputs: def.spec.outputs.map((o) => o.type),
		tools: def.spec.tools ?? [],
	};
}

function loadAll(): AgentInfo[] {
	// Prefer the runtime DefinitionStore (DB-backed in platform mode).
	// Fall back to filesystem for bare `agentforge-core` CLI runs.
	const runtime = getRuntimeDefinitionStore();
	if (runtime) {
		return runtime.listAgents().map(definitionToInfo);
	}

	const agentsDir = join(resolveAgentforgeDir(), "agents");
	let files: string[];
	try {
		files = readdirSync(agentsDir).filter((f) => f.endsWith(".agent.yaml"));
	} catch {
		return [];
	}

	const result: AgentInfo[] = [];
	for (const file of files) {
		try {
			const def = parseDefinitionFile(join(agentsDir, file));
			if (def.kind !== "AgentDefinition") continue;
			result.push(definitionToInfo(def));
		} catch {
			// Skip unparseable files
		}
	}
	return result;
}

export function getAgentList(): AgentSummary[] {
	return loadAll().map(({ id, displayName, role, phase, humanEquivalent }) => ({
		id,
		displayName,
		role,
		phase,
		humanEquivalent,
	}));
}

export function getAgentInfo(agentId: string): AgentInfo | undefined {
	return loadAll().find((a) => a.id === agentId);
}

export function getAllAgentIds(): string[] {
	return loadAll().map((a) => a.id);
}
