import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gates } from "../pages/Gates";

vi.mock("../api/hooks", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		usePendingGates: vi.fn(),
	};
});

import { usePendingGates } from "../api/hooks";

const mockUsePendingGates = vi.mocked(usePendingGates);

function renderWithQuery(ui: React.ReactElement) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchInterval: false } },
	});
	return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("Gates page", () => {
	it("shows loading state", () => {
		mockUsePendingGates.mockReturnValue({
			data: undefined,
			isLoading: true,
		} as ReturnType<typeof usePendingGates>);
		renderWithQuery(<Gates />);
		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("shows empty state when no pending gates", () => {
		mockUsePendingGates.mockReturnValue({
			data: [],
			isLoading: false,
		} as ReturnType<typeof usePendingGates>);
		renderWithQuery(<Gates />);
		expect(screen.getByText(/No pending gates/)).toBeInTheDocument();
	});

	it("renders gate task cards with project names", () => {
		mockUsePendingGates.mockReturnValue({
			data: [
				{
					id: "g1",
					pipelineRunId: "p1",
					phaseCompleted: 1,
					phaseNext: 2,
					status: "pending",
					artifactVersionIds: [],
					createdAt: "2026-04-05T00:00:00Z",
					projectName: "Demo Project",
					pipelineName: "standard-sdlc",
				},
			],
			isLoading: false,
		} as ReturnType<typeof usePendingGates>);
		renderWithQuery(<Gates />);
		expect(screen.getByText("Demo Project")).toBeInTheDocument();
		expect(screen.getByText("Approve")).toBeInTheDocument();
		expect(screen.getByText("Reject")).toBeInTheDocument();
		expect(screen.getByText("Request Revision")).toBeInTheDocument();
	});

	it("shows phase labels from pipeline definition in gate cards", () => {
		mockUsePendingGates.mockReturnValue({
			data: [
				{
					id: "g2",
					pipelineRunId: "p1",
					phaseCompleted: 2,
					phaseNext: 3,
					phaseCompletedName: "Architecture",
					phaseNextName: "Planning",
					status: "pending",
					artifactVersionIds: [],
					createdAt: "2026-04-05T00:00:00Z",
					projectName: "Test",
					pipelineName: "test-pipeline",
				},
			],
			isLoading: false,
		} as ReturnType<typeof usePendingGates>);
		renderWithQuery(<Gates />);
		expect(screen.getByText(/Architecture.*Planning/)).toBeInTheDocument();
	});

	it("falls back to `Phase N` when gate lacks phase names", () => {
		mockUsePendingGates.mockReturnValue({
			data: [
				{
					id: "g3",
					pipelineRunId: "p1",
					phaseCompleted: 4,
					phaseNext: 5,
					status: "pending",
					artifactVersionIds: [],
					createdAt: "2026-04-05T00:00:00Z",
					projectName: "Unknown",
					pipelineName: "orphan-pipeline",
				},
			],
			isLoading: false,
		} as ReturnType<typeof usePendingGates>);
		renderWithQuery(<Gates />);
		expect(screen.getByText(/Phase 4.*Phase 5/)).toBeInTheDocument();
	});
});
