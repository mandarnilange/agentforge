import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunRecord } from "../api/types";
import { RunCard } from "../components/RunCard";

const mockRun: AgentRunRecord = {
	id: "run-1",
	pipelineRunId: "pipe-1",
	agentName: "analyst",
	phase: 1,
	nodeName: "local",
	status: "succeeded",
	inputArtifactIds: [],
	outputArtifactIds: ["/output/frd.json"],
	tokenUsage: { inputTokens: 4231, outputTokens: 8102 },
	provider: "anthropic",
	modelName: "claude-sonnet-4-20250514",
	costUsd: 0.32,
	durationMs: 12100,
	startedAt: "2026-04-05T08:00:00Z",
	completedAt: "2026-04-05T08:00:12Z",
	createdAt: "2026-04-05T08:00:00Z",
};

function renderWithQuery(ui: React.ReactElement) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchInterval: false } },
	});
	return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("RunCard", () => {
	it("renders agent name and status", () => {
		renderWithQuery(<RunCard run={mockRun} />);
		expect(screen.getByText("analyst")).toBeInTheDocument();
		expect(screen.getByText("succeeded")).toBeInTheDocument();
	});

	it("shows cost and token info", () => {
		renderWithQuery(<RunCard run={mockRun} />);
		expect(screen.getByText("$0.320000")).toBeInTheDocument();
		expect(screen.getByText(/4,231 in/)).toBeInTheDocument();
	});

	it("shows duration", () => {
		renderWithQuery(<RunCard run={mockRun} />);
		expect(screen.getByText("12.1s")).toBeInTheDocument();
	});

	it("shows error message for failed runs", () => {
		const failedRun = {
			...mockRun,
			status: "failed" as const,
			error: "architecture not valid JSON",
		};
		renderWithQuery(<RunCard run={failedRun} />);
		expect(screen.getByText("architecture not valid JSON")).toBeInTheDocument();
	});

	it("has expandable conversation section", () => {
		renderWithQuery(<RunCard run={mockRun} />);
		const convBtn = screen.getByText("Conversation");
		expect(convBtn).toBeInTheDocument();
	});

	it("has expandable artifacts section", () => {
		renderWithQuery(<RunCard run={mockRun} />);
		const artBtn = screen.getByText(/Artifacts/);
		expect(artBtn).toBeInTheDocument();
	});
});
