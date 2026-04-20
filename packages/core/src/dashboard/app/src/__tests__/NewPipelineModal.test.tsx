import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewPipelineModal } from "../components/NewPipelineModal";

vi.mock("../api/hooks", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		usePipelineDefinitions: vi.fn(),
	};
});

import { usePipelineDefinitions } from "../api/hooks";

const mockUseDefs = vi.mocked(usePipelineDefinitions);

function renderModal(open: boolean) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchInterval: false } },
	});
	return render(
		<QueryClientProvider client={qc}>
			<MemoryRouter>
				<NewPipelineModal open={open} onClose={vi.fn()} />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("NewPipelineModal", () => {
	it("does not render when closed", () => {
		mockUseDefs.mockReturnValue({
			data: [],
			isLoading: false,
		} as ReturnType<typeof usePipelineDefinitions>);
		renderModal(false);
		expect(screen.queryByText("New Pipeline")).not.toBeInTheDocument();
	});

	it("renders when open with pipeline dropdown", () => {
		mockUseDefs.mockReturnValue({
			data: [
				{
					name: "standard-sdlc",
					displayName: "Standard SDLC",
					description: "Full pipeline",
					inputs: [],
				},
			],
			isLoading: false,
		} as ReturnType<typeof usePipelineDefinitions>);
		renderModal(true);
		expect(screen.getByText("New Pipeline")).toBeInTheDocument();
		expect(screen.getByText("Standard SDLC")).toBeInTheDocument();
	});

	it("shows project name input", () => {
		mockUseDefs.mockReturnValue({
			data: [],
			isLoading: false,
		} as ReturnType<typeof usePipelineDefinitions>);
		renderModal(true);
		expect(screen.getByPlaceholderText("my-project")).toBeInTheDocument();
	});

	it("has cancel and start buttons", () => {
		mockUseDefs.mockReturnValue({
			data: [],
			isLoading: false,
		} as ReturnType<typeof usePipelineDefinitions>);
		renderModal(true);
		expect(screen.getByText("Cancel")).toBeInTheDocument();
		expect(screen.getByText("Start Pipeline")).toBeInTheDocument();
	});

	it("start button is disabled without selection", () => {
		mockUseDefs.mockReturnValue({
			data: [
				{
					name: "test",
					displayName: "Test",
					description: "",
					inputs: [],
				},
			],
			isLoading: false,
		} as ReturnType<typeof usePipelineDefinitions>);
		renderModal(true);
		const btn = screen.getByText("Start Pipeline");
		expect(btn).toBeDisabled();
	});
});
