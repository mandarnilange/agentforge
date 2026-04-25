import type { IncomingMessage, ServerResponse } from "node:http";
import { stringify as stringifyYaml } from "yaml";
import type { DashboardResourceService } from "../../application/dashboard/resource-service.js";
import type { GateController } from "../../control-plane/gate-controller.js";
import type { PipelineController } from "../../control-plane/pipeline-controller.js";
import type { PipelineDefinitionYaml } from "../../definitions/parser.js";
import type { DefinitionStore } from "../../definitions/store.js";
import {
	getDiscoveredSchema,
	listDiscoveredSchemas,
} from "../../schemas/index.js";
import { generateArtifactPdf } from "../pdf-generator.js";

export type PipelineExecutor = (
	pipelineRunId: string,
	projectName: string,
	pipelineDef: PipelineDefinitionYaml,
	inputs: Record<string, string>,
) => void;

/**
 * Versioned definition source — pluggable so dashboard reads can pick up
 * version + timestamp metadata that the in-memory `DefinitionStore` doesn't
 * track. Backed by `PgDefinitionStore` in PG mode and `SqliteDefinitionStore`
 * in SQLite mode; left undefined for bare `agentforge-core` standalone use.
 */
export interface VersionedDefinitionRow {
	name: string;
	specYaml: string;
	version: number;
	createdAt: string;
	updatedAt: string;
}
export interface VersionedDefinitionSource {
	list(
		kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
	): Promise<VersionedDefinitionRow[]>;
	get(
		kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
		name: string,
	): Promise<VersionedDefinitionRow | null>;
}

export interface ServerContext {
	service: DashboardResourceService;
	gateController?: GateController;
	pipelineController?: PipelineController;
	definitionStore?: DefinitionStore;
	versionedDefinitionSource?: VersionedDefinitionSource;
	executePipeline?: PipelineExecutor;
}

export async function handleApiRoute(
	path: string,
	url: URL,
	res: ServerResponse,
	ctx: ServerContext,
): Promise<void> {
	const service = ctx.service;
	if (path === "/api/health") {
		json(res, 200, { status: "ok", uptime: process.uptime() });
		return;
	}
	if (path === "/api/v1/status") {
		json(res, 200, {
			readOnly: !ctx.executePipeline,
			hasDefinitions: (ctx.definitionStore?.listAgents().length ?? 0) > 0,
		});
		return;
	}
	if (path === "/api/v1/summary") {
		json(res, 200, await service.getSummary());
		return;
	}
	if (path === "/api/v1/pipelines") {
		json(res, 200, await service.listPipelines());
		return;
	}
	if (path === "/api/v1/pipeline-definitions") {
		if (!ctx.definitionStore) {
			json(res, 200, []);
			return;
		}
		const defs = ctx.definitionStore.listPipelines().map((d) => ({
			name: d.metadata.name,
			displayName: d.metadata.displayName ?? d.metadata.name,
			description: d.metadata.description ?? "",
			inputs: d.spec.input ?? [],
		}));
		json(res, 200, defs);
		return;
	}
	if (path === "/api/v1/gates/pending") {
		json(res, 200, await service.listPendingGates());
		return;
	}
	if (path === "/api/v1/cost-summary") {
		json(res, 200, await service.getCostSummary());
		return;
	}
	if (path === "/api/v1/audit-log") {
		const pipelineId = url.searchParams.get("pipelineId") ?? undefined;
		json(res, 200, await service.getAuditLog(pipelineId));
		return;
	}
	if (path === "/api/v1/artifacts") {
		const pipelineId = url.searchParams.get("pipelineId") ?? undefined;
		json(res, 200, await service.listArtifacts(pipelineId));
		return;
	}
	if (path === "/api/v1/artifact-content") {
		const artifactPath = url.searchParams.get("path");
		if (!artifactPath) {
			json(res, 400, { error: "path query parameter is required" });
			return;
		}
		const content = service.getArtifactContent(artifactPath);
		if (!content) {
			json(res, 404, { error: "Artifact not found" });
			return;
		}
		json(res, 200, content);
		return;
	}
	if (path === "/api/v1/artifact-pdf") {
		const artifactPath = url.searchParams.get("path");
		if (!artifactPath) {
			json(res, 400, { error: "path query parameter is required" });
			return;
		}
		const content = service.getArtifactContent(artifactPath);
		if (!content) {
			json(res, 404, { error: "Artifact not found" });
			return;
		}
		const filename = artifactPath.split("/").pop() ?? "artifact";
		const pdfName = filename.replace(/\.json$/, ".pdf");
		try {
			const buffer = await generateArtifactPdf(content.content, filename);
			res.writeHead(200, {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${pdfName}"`,
				"Content-Length": buffer.length,
			});
			res.end(buffer);
		} catch {
			json(res, 500, { error: "PDF generation failed" });
		}
		return;
	}
	if (path.startsWith("/api/v1/pipelines/")) {
		const id = path.split("/")[4];
		const pipeline = await service.getPipeline(id);
		if (!pipeline) {
			json(res, 404, { error: "Pipeline not found" });
			return;
		}
		json(res, 200, pipeline);
		return;
	}
	if (path === "/api/v1/runs") {
		const pipelineId = url.searchParams.get("pipelineId");
		if (!pipelineId) {
			json(res, 400, { error: "pipelineId is required" });
			return;
		}
		json(res, 200, await service.listRuns(pipelineId));
		return;
	}
	if (path.startsWith("/api/v1/runs/")) {
		const parts = path.split("/");
		const id = parts[4];
		if (parts.length === 5) {
			const run = await service.getRun(id);
			if (!run) {
				json(res, 404, { error: "Run not found" });
				return;
			}
			json(res, 200, run);
			return;
		}
		if (parts[5] === "artifacts") {
			const artifacts = await service.getRunArtifacts(id);
			if (!artifacts) {
				json(res, 404, { error: "Run not found" });
				return;
			}
			json(res, 200, artifacts);
			return;
		}
		if (parts[5] === "conversation") {
			const conversation = await service.getRunConversation(id);
			if (!conversation) {
				json(res, 404, { error: "Run not found" });
				return;
			}
			json(res, 200, conversation);
			return;
		}
		if (parts[5] === "logs") {
			const logs = await service.getRunLogs(id);
			if (!logs) {
				json(res, 404, { error: "Run not found" });
				return;
			}
			json(res, 200, logs);
			return;
		}
	}
	if (path === "/api/v1/nodes") {
		json(res, 200, await service.listNodes());
		return;
	}
	if (path.startsWith("/api/v1/nodes/")) {
		const name = decodeURIComponent(path.split("/")[4] ?? "");
		const node = await service.getNode(name);
		if (!node) {
			json(res, 404, { error: "Node not found" });
			return;
		}
		json(res, 200, node);
		return;
	}
	if (path === "/api/v1/gates") {
		const pipelineId = url.searchParams.get("pipelineId");
		if (!pipelineId) {
			json(res, 400, { error: "pipelineId is required" });
			return;
		}
		json(res, 200, await service.listGates(pipelineId));
		return;
	}
	if (path.startsWith("/api/v1/gates/")) {
		const id = path.split("/")[4];
		const gate = await service.getGate(id);
		if (!gate) {
			json(res, 404, { error: "Gate not found" });
			return;
		}
		json(res, 200, gate);
		return;
	}

	// Definition list/detail endpoints consumed by the Settings page.
	// Prefers the versioned source (PG / SQLite definition store) so version
	// + timestamps surface correctly. Falls back to in-memory DefinitionStore
	// for bare `agentforge-core` use where no DB-backed source exists.
	const defRoute = matchDefinitionRoute(path);
	if (defRoute) {
		await handleDefinitionRead(
			res,
			defRoute,
			ctx.definitionStore,
			ctx.versionedDefinitionSource,
		);
		return;
	}

	json(res, 404, { error: "Not found" });
}

type DefinitionRouteKind = "agents" | "pipeline-defs" | "node-defs" | "schemas";

interface DefinitionRouteMatch {
	kind: DefinitionRouteKind;
	name?: string;
}

function matchDefinitionRoute(path: string): DefinitionRouteMatch | null {
	for (const kind of [
		"agents",
		"pipeline-defs",
		"node-defs",
		"schemas",
	] as const) {
		const prefix = `/api/v1/${kind}`;
		if (path === prefix) return { kind };
		if (path.startsWith(`${prefix}/`)) {
			const name = decodeURIComponent(path.slice(prefix.length + 1));
			if (name.length > 0 && !name.includes("/")) return { kind, name };
		}
	}
	return null;
}

async function handleDefinitionRead(
	res: ServerResponse,
	match: DefinitionRouteMatch,
	store: DefinitionStore | undefined,
	versioned: VersionedDefinitionSource | undefined,
): Promise<void> {
	const kindToFull = {
		agents: "AgentDefinition",
		"pipeline-defs": "PipelineDefinition",
		"node-defs": "NodeDefinition",
	} as const;

	// Schemas: always read from the global validator registry — schema
	// bodies are stored as JSON, not as a parsed yaml definition, so the
	// versioned-row shape doesn't apply.
	if (match.kind === "schemas") {
		if (match.name) {
			const body = getDiscoveredSchema(match.name);
			if (!body) {
				json(res, 404, { error: `Schema "${match.name}" not found` });
				return;
			}
			json(res, 200, schemaDetail(match.name, body));
			return;
		}
		json(
			res,
			200,
			listDiscoveredSchemas().map((name) => schemaSummary(name)),
		);
		return;
	}

	const kindFull = kindToFull[match.kind];

	// Versioned source (PG / SQLite definition store) wins — surfaces real
	// version + timestamp + spec_yaml that include applied edits.
	if (versioned) {
		if (match.name) {
			const row = await versioned.get(kindFull, match.name);
			if (!row) {
				json(res, 404, { error: `${kindFull} "${match.name}" not found` });
				return;
			}
			json(res, 200, versionedDetail(kindFull, row));
			return;
		}
		const rows = await versioned.list(kindFull);
		json(
			res,
			200,
			rows.map((r) => versionedSummary(kindFull, r)),
		);
		return;
	}

	// Fallback: in-memory DefinitionStore (no version info — surface as v1).
	if (!store) {
		if (match.name) json(res, 404, { error: "Not found" });
		else json(res, 200, []);
		return;
	}

	if (match.kind === "agents") {
		if (match.name) {
			const def = store.getAgent(match.name);
			if (!def) {
				json(res, 404, { error: `AgentDefinition "${match.name}" not found` });
				return;
			}
			json(res, 200, definitionDetail("AgentDefinition", def));
			return;
		}
		json(
			res,
			200,
			store.listAgents().map((d) => definitionSummary("AgentDefinition", d)),
		);
		return;
	}

	if (match.kind === "pipeline-defs") {
		if (match.name) {
			const def = store.getPipeline(match.name);
			if (!def) {
				json(res, 404, {
					error: `PipelineDefinition "${match.name}" not found`,
				});
				return;
			}
			json(res, 200, definitionDetail("PipelineDefinition", def));
			return;
		}
		json(
			res,
			200,
			store
				.listPipelines()
				.map((d) => definitionSummary("PipelineDefinition", d)),
		);
		return;
	}

	// node-defs
	if (match.name) {
		const def = store.getNode(match.name);
		if (!def) {
			json(res, 404, { error: `NodeDefinition "${match.name}" not found` });
			return;
		}
		json(res, 200, definitionDetail("NodeDefinition", def));
		return;
	}
	json(
		res,
		200,
		store.listNodes().map((d) => definitionSummary("NodeDefinition", d)),
	);
}

function versionedSummary(
	kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
	row: VersionedDefinitionRow,
) {
	return {
		name: row.name,
		kind,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function versionedDetail(
	kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
	row: VersionedDefinitionRow,
) {
	// `specYaml` from the store is JSON.stringify of the YAML object. The
	// dashboard renders it in a code panel — convert to YAML for readability,
	// matching what definitionDetail does for the in-memory path.
	let specYaml = row.specYaml;
	try {
		const parsed = JSON.parse(row.specYaml);
		specYaml = stringifyYaml(parsed);
	} catch {
		// Leave as-is if not parseable JSON.
	}
	return {
		...versionedSummary(kind, row),
		specYaml,
	};
}

function schemaSummary(name: string) {
	return {
		name,
		kind: "Schema",
		version: 1,
		createdAt: "",
		updatedAt: "",
	};
}

function schemaDetail(name: string, body: Record<string, unknown>) {
	return {
		...schemaSummary(name),
		// Render as JSON for the existing pre-block viewer; ResourceDef.specYaml
		// is what the SPA prints, so we put the schema body there as JSON.
		specYaml: JSON.stringify(body, null, 2),
	};
}

// The in-memory YAML DefinitionStore doesn't track versions or timestamps —
// those fields only exist in platform's SqliteDefinitionStore. Surface stable
// defaults so the Settings UI renders cleanly without wider changes.
function definitionSummary(
	kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
	def: { metadata: { name: string } },
) {
	return {
		name: def.metadata.name,
		kind,
		version: 1,
		createdAt: "",
		updatedAt: "",
	};
}

function definitionDetail(
	kind: "AgentDefinition" | "PipelineDefinition" | "NodeDefinition",
	def: { metadata: { name: string } },
) {
	return {
		...definitionSummary(kind, def),
		specYaml: stringifyYaml(def),
	};
}

export async function handlePost(
	req: IncomingMessage,
	res: ServerResponse,
	path: string,
	ctx: ServerContext,
): Promise<void> {
	// Start pipeline
	if (path === "/api/v1/pipelines") {
		if (!ctx.pipelineController || !ctx.definitionStore) {
			json(res, 503, {
				error: "Pipeline operations not available in read-only mode",
			});
			return;
		}
		const body = await readBody(req);
		const defName = body.definition;
		const projectName = body.projectName;
		if (!defName || !projectName) {
			json(res, 400, {
				error: "definition and projectName are required",
			});
			return;
		}
		const pipelineDef = ctx.definitionStore.getPipeline(defName);
		if (!pipelineDef) {
			json(res, 400, { error: `Pipeline definition "${defName}" not found` });
			return;
		}
		if (!ctx.executePipeline) {
			json(res, 503, {
				error:
					"Agent execution is not configured — set ANTHROPIC_API_KEY and restart the dashboard.",
			});
			return;
		}
		try {
			const inputs: Record<string, string> = {};
			for (const [k, v] of Object.entries(body)) {
				if (k !== "definition" && k !== "projectName") {
					inputs[k] = String(v);
				}
			}
			const run = await ctx.pipelineController.startPipeline(
				projectName,
				pipelineDef,
				inputs,
			);
			// Fire executor in background — don't await
			if (ctx.executePipeline) {
				ctx.executePipeline(run.id, projectName, pipelineDef, inputs);
			}
			json(res, 201, run);
		} catch (err) {
			json(res, 400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	// Pipeline stop/retry operations
	const pipelineAction = path.match(
		/^\/api\/v1\/pipelines\/([^/]+)\/(stop|retry)$/,
	);
	if (pipelineAction) {
		if (!ctx.pipelineController || !ctx.definitionStore) {
			json(res, 503, {
				error: "Pipeline operations not available in read-only mode",
			});
			return;
		}
		const [, pipelineId, action] = pipelineAction;
		try {
			if (action === "stop") {
				const updated = await ctx.pipelineController.stopPipeline(pipelineId);
				json(res, 200, updated);
			} else {
				// retry — need pipeline def to re-schedule agents
				const pipeline =
					await ctx.pipelineController.getPipelineRun(pipelineId);
				if (!pipeline) {
					json(res, 404, { error: `Pipeline run "${pipelineId}" not found` });
					return;
				}
				const pipelineDef = ctx.definitionStore.getPipeline(
					pipeline.pipelineName,
				);
				if (!pipelineDef) {
					json(res, 400, {
						error: `Pipeline definition "${pipeline.pipelineName}" not found`,
					});
					return;
				}
				const updated = await ctx.pipelineController.retryPipeline(
					pipelineId,
					pipelineDef,
				);
				// Fire executor in background — restore original inputs so phase-1 agents get them
				if (ctx.executePipeline) {
					ctx.executePipeline(
						pipelineId,
						pipeline.projectName,
						pipelineDef,
						pipeline.inputs ?? {},
					);
				}
				json(res, 200, updated);
			}
		} catch (err) {
			json(res, 400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	// Gate actions
	const { gateController } = ctx;
	if (!gateController) {
		json(res, 503, { error: "Gate actions not available in read-only mode" });
		return;
	}

	const gateAction = path.match(
		/^\/api\/v1\/gates\/([^/]+)\/(approve|reject|revise)$/,
	);
	if (gateAction) {
		const [, gateId, action] = gateAction;
		const body = await readBody(req);
		try {
			// Use PipelineController when available so gate actions advance the pipeline
			if (ctx.pipelineController && ctx.definitionStore) {
				const gate = await ctx.service.getGate(gateId);
				if (!gate) throw new Error(`Gate "${gateId}" not found`);
				const pipelineDetail = await ctx.service.getPipeline(
					gate.pipelineRunId,
				);
				const pipelineDef = pipelineDetail
					? ctx.definitionStore.getPipeline(pipelineDetail.run.pipelineName)
					: undefined;

				if (action === "approve" && pipelineDef) {
					await ctx.pipelineController.approveGate(
						gateId,
						pipelineDef,
						body.reviewer,
						body.comment,
					);
					// Fire executor to run newly scheduled agents
					if (ctx.executePipeline && pipelineDetail) {
						ctx.executePipeline(
							gate.pipelineRunId,
							pipelineDetail.run.projectName,
							pipelineDef,
							{},
						);
					}
				} else if (action === "reject") {
					await ctx.pipelineController.rejectGate(
						gateId,
						body.reviewer,
						body.comment,
					);
				} else if (action === "revise") {
					await ctx.pipelineController.reviseGate(
						gateId,
						body.notes ?? "",
						body.reviewer,
					);
					// Fire executor to re-run agents with revision notes
					if (ctx.executePipeline && pipelineDef && pipelineDetail) {
						ctx.executePipeline(
							gate.pipelineRunId,
							pipelineDetail.run.projectName,
							pipelineDef,
							{},
						);
					}
				} else {
					// Fallback: no pipeline def found, just update gate status
					await gateController.approve(gateId, body.reviewer, body.comment);
				}
				// Return updated gate
				const updatedGate = await ctx.service.getGate(gateId);
				json(res, 200, updatedGate);
			} else {
				// Read-only mode: just update gate status without pipeline advancement
				let gate: Awaited<ReturnType<GateController["approve"]>>;
				if (action === "approve") {
					gate = await gateController.approve(
						gateId,
						body.reviewer,
						body.comment,
					);
				} else if (action === "reject") {
					gate = await gateController.reject(
						gateId,
						body.reviewer,
						body.comment,
					);
				} else {
					gate = await gateController.revise(
						gateId,
						body.notes ?? "",
						body.reviewer,
					);
				}
				json(res, 200, gate);
			}
		} catch (err) {
			json(res, 400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	json(res, 404, { error: "Not found" });
}

function readBody(req: IncomingMessage): Promise<Record<string, string>> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf-8");
				resolve(raw ? (JSON.parse(raw) as Record<string, string>) : {});
			} catch {
				resolve({});
			}
		});
	});
}

export function json(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.end(JSON.stringify(body));
}
