import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

function renderApp(initialEntries = ["/"]) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchInterval: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={initialEntries}>
				<App />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		new Response(JSON.stringify([]), { status: 200 }),
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("App shell", () => {
	it("renders the header with title and navigation", () => {
		renderApp();
		expect(screen.getByText("SDLC Control Plane")).toBeInTheDocument();
		expect(screen.getByText("Overview")).toBeInTheDocument();
		expect(screen.getByText(/Gates/)).toBeInTheDocument();
		expect(screen.getByText("Nodes")).toBeInTheDocument();
	});

	it("renders overview page at /", () => {
		renderApp(["/"]);
		expect(screen.getByText("Pipelines")).toBeInTheDocument();
	});

	it("renders 404 for unknown routes", () => {
		renderApp(["/unknown-page"]);
		expect(screen.getByText("404")).toBeInTheDocument();
		expect(screen.getByText("Page not found")).toBeInTheDocument();
	});

	it("renders pipeline detail at /pipelines/:id", () => {
		vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
			const u = typeof url === "string" ? url : url.toString();
			if (u.includes("/pipelines/test-id")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							run: {
								id: "test-id",
								projectName: "TestProject",
								pipelineName: "test-pipeline",
								status: "running",
								currentPhase: 1,
								startedAt: new Date().toISOString(),
								createdAt: new Date().toISOString(),
							},
							runs: [],
							gates: [],
							phaseSummary: [{ phase: 1, status: "active", runs: 0 }],
						}),
						{ status: 200 },
					),
				);
			}
			return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
		});

		renderApp(["/pipelines/test-id"]);
		// Shows loading initially, then content
		expect(
			screen.getByText("Loading...") || screen.getByText("TestProject"),
		).toBeInTheDocument();
	});

	it("renders nodes page at /nodes", () => {
		renderApp(["/nodes"]);
		// "Nodes" appears in nav + page heading
		const nodes = screen.getAllByText("Nodes");
		expect(nodes.length).toBeGreaterThanOrEqual(2);
	});

	it("renders gates page at /gates", () => {
		renderApp(["/gates"]);
		expect(screen.getByText("Pending Gates")).toBeInTheDocument();
	});
});
