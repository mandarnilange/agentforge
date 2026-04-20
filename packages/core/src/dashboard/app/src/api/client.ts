import type {
	ArtifactContent,
	ArtifactResource,
	AuditLogEntry,
	ConversationEntry,
	CostSummary,
	DashboardSummary,
	Gate,
	NodeRecord,
	PendingGate,
	PipelineDefinitionSummary,
	PipelineDetail,
	PipelineRun,
} from "./types";

const BASE = "/api/v1";

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Request failed: ${res.status}`,
		);
	}
	return res.json() as Promise<T>;
}

async function postJson<T>(
	url: string,
	body: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(
			(data as { error?: string }).error ?? `Request failed: ${res.status}`,
		);
	}
	return res.json() as Promise<T>;
}

export interface AppStatus {
	readOnly: boolean;
	hasDefinitions: boolean;
}

export const api = {
	getStatus: () => fetchJson<AppStatus>(`${BASE}/status`),

	getSummary: () => fetchJson<DashboardSummary>(`${BASE}/summary`),

	listPipelines: () => fetchJson<PipelineRun[]>(`${BASE}/pipelines`),

	getPipeline: (id: string) =>
		fetchJson<PipelineDetail>(`${BASE}/pipelines/${id}`),

	listNodes: () => fetchJson<NodeRecord[]>(`${BASE}/nodes`),

	getNode: (name: string) => fetchJson<NodeRecord>(`${BASE}/nodes/${name}`),

	listGates: (pipelineId: string) =>
		fetchJson<Gate[]>(`${BASE}/gates?pipelineId=${pipelineId}`),

	getRunArtifacts: (runId: string) =>
		fetchJson<ArtifactResource[]>(`${BASE}/runs/${runId}/artifacts`),

	getArtifactContent: (path: string) =>
		fetchJson<ArtifactContent>(
			`${BASE}/artifact-content?path=${encodeURIComponent(path)}`,
		),

	getRunConversation: (runId: string) =>
		fetchJson<ConversationEntry[]>(`${BASE}/runs/${runId}/conversation`),

	getCostSummary: () => fetchJson<CostSummary>(`${BASE}/cost-summary`),

	getAuditLog: (pipelineId?: string) =>
		fetchJson<AuditLogEntry[]>(
			pipelineId
				? `${BASE}/audit-log?pipelineId=${pipelineId}`
				: `${BASE}/audit-log`,
		),

	listPendingGates: () => fetchJson<PendingGate[]>(`${BASE}/gates/pending`),

	listPipelineDefinitions: () =>
		fetchJson<PipelineDefinitionSummary[]>(`${BASE}/pipeline-definitions`),

	createPipeline: (body: Record<string, string>) =>
		postJson<PipelineRun>(`${BASE}/pipelines`, body),

	gateAction: (
		gateId: string,
		action: "approve" | "reject" | "revise",
		body: Record<string, string>,
	) => postJson<Gate>(`${BASE}/gates/${gateId}/${action}`, body),

	stopPipeline: (id: string) =>
		postJson<PipelineRun>(`${BASE}/pipelines/${id}/stop`, {}),

	retryPipeline: (id: string) =>
		postJson<PipelineRun>(`${BASE}/pipelines/${id}/retry`, {}),

	// --- Definition CRUD ---
	listAgentDefs: () => fetchJson<ResourceDef[]>(`${BASE}/agents`),
	getAgentDef: (name: string) =>
		fetchJson<ResourceDef>(`${BASE}/agents/${name}`),
	createAgentDef: (name: string, specYaml: string) =>
		postJson<ResourceDef>(`${BASE}/agents`, { name, specYaml }),
	updateAgentDef: (name: string, specYaml: string) =>
		putJson<ResourceDef>(`${BASE}/agents/${name}`, { specYaml }),
	deleteAgentDef: (name: string) => deleteJson(`${BASE}/agents/${name}`),
	getAgentDefHistory: (name: string) =>
		fetchJson<ResourceDefHistory[]>(`${BASE}/agents/${name}/history`),

	listPipelineDefs: () => fetchJson<ResourceDef[]>(`${BASE}/pipeline-defs`),
	getPipelineDef: (name: string) =>
		fetchJson<ResourceDef>(`${BASE}/pipeline-defs/${name}`),

	listNodeDefs: () => fetchJson<ResourceDef[]>(`${BASE}/node-defs`),
	getNodeDef: (name: string) =>
		fetchJson<ResourceDef>(`${BASE}/node-defs/${name}`),
};

export interface ResourceDef {
	name: string;
	kind: string;
	version: number;
	specYaml?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ResourceDefHistory {
	version: number;
	changedBy: string;
	changeType: string;
	createdAt: string;
}

async function putJson<T>(
	url: string,
	body: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(url, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(
			(data as { error?: string }).error ?? `Request failed: ${res.status}`,
		);
	}
	return res.json() as Promise<T>;
}

async function deleteJson(url: string): Promise<void> {
	const res = await fetch(url, { method: "DELETE" });
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(
			(data as { error?: string }).error ?? `Request failed: ${res.status}`,
		);
	}
}
