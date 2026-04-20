import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentRunRecord, PhaseSummary } from "../api/types";
import { PhaseAgentMap } from "../components/PhaseAgentMap";

const phases: PhaseSummary[] = [
	{ phase: 1, name: "Requirements", status: "succeeded", runs: 1 },
	{ phase: 2, name: "Architecture", status: "succeeded", runs: 1 },
	{ phase: 3, name: "Planning", status: "succeeded", runs: 1 },
	{ phase: 4, name: "Implementation", status: "running", runs: 3 },
	{ phase: 5, name: "QA", status: "pending", runs: 0 },
	{ phase: 6, name: "DevOps", status: "pending", runs: 0 },
];

const runs: AgentRunRecord[] = [
	{
		id: "r1",
		pipelineRunId: "p1",
		agentName: "analyst",
		phase: 1,
		nodeName: "local",
		status: "succeeded",
		inputArtifactIds: [],
		outputArtifactIds: [],
		costUsd: 0.32,
		durationMs: 12100,
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
	{
		id: "r2",
		pipelineRunId: "p1",
		agentName: "architect",
		phase: 2,
		nodeName: "local",
		status: "succeeded",
		inputArtifactIds: [],
		outputArtifactIds: [],
		costUsd: 0.28,
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
	{
		id: "r3",
		pipelineRunId: "p1",
		agentName: "planner",
		phase: 3,
		nodeName: "local",
		status: "succeeded",
		inputArtifactIds: [],
		outputArtifactIds: [],
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
	{
		id: "r4",
		pipelineRunId: "p1",
		agentName: "frontend",
		phase: 4,
		nodeName: "local",
		status: "running",
		inputArtifactIds: [],
		outputArtifactIds: [],
		costUsd: 0.18,
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
	{
		id: "r5",
		pipelineRunId: "p1",
		agentName: "developer",
		phase: 4,
		nodeName: "local",
		status: "running",
		inputArtifactIds: [],
		outputArtifactIds: [],
		costUsd: 0.22,
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
	{
		id: "r6",
		pipelineRunId: "p1",
		agentName: "dataengineer",
		phase: 4,
		nodeName: "local",
		status: "failed",
		inputArtifactIds: [],
		outputArtifactIds: [],
		error: "architecture not valid JSON",
		startedAt: "2026-04-05T00:00:00Z",
		createdAt: "2026-04-05T00:00:00Z",
	},
];

describe("PhaseAgentMap", () => {
	it("renders all phase labels", () => {
		render(<PhaseAgentMap phases={phases} runs={runs} />);
		expect(screen.getByText("Requirements")).toBeInTheDocument();
		expect(screen.getByText("Architecture")).toBeInTheDocument();
		expect(screen.getByText("Planning")).toBeInTheDocument();
		expect(screen.getByText("Implementation")).toBeInTheDocument();
		expect(screen.getByText("QA")).toBeInTheDocument();
		expect(screen.getByText("DevOps")).toBeInTheDocument();
	});

	it("renders agent cards for each phase", () => {
		render(<PhaseAgentMap phases={phases} runs={runs} />);
		expect(screen.getByText("analyst")).toBeInTheDocument();
		expect(screen.getByText("architect")).toBeInTheDocument();
		expect(screen.getByText("planner")).toBeInTheDocument();
	});

	it("shows multiple agents stacked for parallel phases", () => {
		render(<PhaseAgentMap phases={phases} runs={runs} />);
		expect(screen.getByText("frontend")).toBeInTheDocument();
		expect(screen.getByText("developer")).toBeInTheDocument();
		expect(screen.getByText("dataengineer")).toBeInTheDocument();
	});

	it("shows cost on agent cards", () => {
		render(<PhaseAgentMap phases={phases} runs={runs} />);
		expect(screen.getByText("$0.32")).toBeInTheDocument();
		expect(screen.getByText("$0.22")).toBeInTheDocument();
	});

	it("shows FAILED label on failed agents", () => {
		render(<PhaseAgentMap phases={phases} runs={runs} />);
		const failedCards = screen.getAllByText("failed");
		expect(failedCards.length).toBeGreaterThanOrEqual(1);
	});

	it("handles empty phases gracefully", () => {
		render(
			<PhaseAgentMap
				phases={[{ phase: 5, name: "QA", status: "pending", runs: 0 }]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("QA")).toBeInTheDocument();
	});

	it("shows only the phases supplied by the pipeline definition", () => {
		render(
			<PhaseAgentMap
				phases={[
					{ phase: 1, name: "Requirements", status: "running", runs: 1 },
				]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("Requirements")).toBeInTheDocument();
		expect(screen.queryByText("Architecture")).not.toBeInTheDocument();
		expect(screen.queryByText("Planning")).not.toBeInTheDocument();
		expect(screen.queryByText("Implementation")).not.toBeInTheDocument();
		expect(screen.queryByText("QA")).not.toBeInTheDocument();
		expect(screen.queryByText("DevOps")).not.toBeInTheDocument();
	});

	it("renders custom pipeline phase names (non-SDLC)", () => {
		render(
			<PhaseAgentMap
				phases={[
					{ phase: 1, name: "research", status: "succeeded", runs: 1 },
					{ phase: 2, name: "outline", status: "running", runs: 1 },
					{ phase: 3, name: "write", status: "pending", runs: 0 },
				]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("research")).toBeInTheDocument();
		expect(screen.getByText("outline")).toBeInTheDocument();
		expect(screen.getByText("write")).toBeInTheDocument();
		// The old hardcoded SDLC labels must not leak in
		expect(screen.queryByText("Requirements")).not.toBeInTheDocument();
		expect(screen.queryByText("Architecture")).not.toBeInTheDocument();
	});

	it("falls back to `Phase N` when the phase name is absent", () => {
		render(
			<PhaseAgentMap
				phases={[{ phase: 3, status: "running", runs: 1 }]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("Phase 3")).toBeInTheDocument();
	});

	it("shows gate badge when phase is waiting-gate", () => {
		render(
			<PhaseAgentMap
				phases={[
					{ phase: 1, status: "waiting-gate", runs: 1 },
					{ phase: 2, status: "pending", runs: 0 },
				]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("ACTION NEEDED")).toBeInTheDocument();
	});

	it("shows revision requested badge", () => {
		render(
			<PhaseAgentMap
				phases={[{ phase: 1, status: "revision-requested", runs: 1 }]}
				runs={[]}
			/>,
		);
		expect(screen.getByText("REVISION REQUESTED")).toBeInTheDocument();
	});
});
