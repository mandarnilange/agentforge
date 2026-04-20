import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export function useStatus() {
	return useQuery({
		queryKey: ["status"],
		queryFn: api.getStatus,
		staleTime: 60_000,
	});
}

export function useSummary() {
	return useQuery({
		queryKey: ["summary"],
		queryFn: api.getSummary,
	});
}

export function useCostSummary() {
	return useQuery({
		queryKey: ["cost-summary"],
		queryFn: api.getCostSummary,
	});
}

export function useAuditLog(pipelineId?: string) {
	return useQuery({
		queryKey: ["audit-log", pipelineId],
		queryFn: () => api.getAuditLog(pipelineId),
	});
}

export function usePipelines() {
	return useQuery({
		queryKey: ["pipelines"],
		queryFn: api.listPipelines,
	});
}

export function usePipeline(id: string) {
	return useQuery({
		queryKey: ["pipeline", id],
		queryFn: () => api.getPipeline(id),
		enabled: !!id,
	});
}

export function useNodes() {
	return useQuery({
		queryKey: ["nodes"],
		queryFn: api.listNodes,
	});
}

export function usePendingGates() {
	return useQuery({
		queryKey: ["pending-gates"],
		queryFn: api.listPendingGates,
	});
}

export function usePipelineDefinitions() {
	return useQuery({
		queryKey: ["pipeline-definitions"],
		queryFn: api.listPipelineDefinitions,
		refetchInterval: false,
	});
}

export function useArtifactContent(path: string, enabled = false) {
	return useQuery({
		queryKey: ["artifact-content", path],
		queryFn: () => api.getArtifactContent(path),
		enabled: enabled && !!path,
		refetchInterval: false,
	});
}

export function useRunArtifacts(runId: string, enabled = false) {
	return useQuery({
		queryKey: ["run-artifacts", runId],
		queryFn: () => api.getRunArtifacts(runId),
		enabled,
		refetchInterval: false,
	});
}

export function useRunConversation(
	runId: string,
	enabled = false,
	live = false,
) {
	return useQuery({
		queryKey: ["run-conversation", runId],
		queryFn: () => api.getRunConversation(runId),
		enabled,
		refetchInterval: live ? 3000 : false,
	});
}
