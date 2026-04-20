import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

function renderSettings() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchInterval: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter initialEntries={["/settings"]}>
				<App />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/api/v1/summary")) {
			return new Response(
				JSON.stringify({
					totalPipelines: 0,
					runningPipelines: 0,
					pendingGates: 0,
					totalNodes: 1,
					totalCostUsd: 0,
					recentRuns: [],
				}),
				{ status: 200 },
			);
		}
		if (url.includes("/api/v1/agents")) {
			return new Response(
				JSON.stringify([
					{
						name: "developer",
						kind: "AgentDefinition",
						version: 2,
						createdAt: "2026-04-08",
						updatedAt: "2026-04-08",
					},
					{
						name: "analyst",
						kind: "AgentDefinition",
						version: 1,
						createdAt: "2026-04-08",
						updatedAt: "2026-04-08",
					},
				]),
				{ status: 200 },
			);
		}
		if (url.includes("/api/v1/pipeline-defs")) {
			return new Response(
				JSON.stringify([
					{
						name: "standard-sdlc",
						kind: "PipelineDefinition",
						version: 1,
						createdAt: "2026-04-08",
						updatedAt: "2026-04-08",
					},
				]),
				{ status: 200 },
			);
		}
		if (url.includes("/api/v1/node-defs")) {
			return new Response(
				JSON.stringify([
					{
						name: "local",
						kind: "NodeDefinition",
						version: 1,
						createdAt: "2026-04-08",
						updatedAt: "2026-04-08",
					},
				]),
				{ status: 200 },
			);
		}
		return new Response(JSON.stringify([]), { status: 200 });
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Settings page (P15.5-T4/T5/T6)", () => {
	it("renders settings page with agent tab active by default", async () => {
		renderSettings();
		await waitFor(() => {
			expect(screen.getByText(/Agent Definitions/)).toBeTruthy();
		});
	});

	it("shows agent definitions on Agents tab", async () => {
		renderSettings();
		await waitFor(() => {
			expect(screen.getByText("developer")).toBeTruthy();
		});
		expect(screen.getByText("analyst")).toBeTruthy();
	});

	it("shows agent count", async () => {
		renderSettings();
		await waitFor(() => {
			expect(screen.getByText(/Agent Definitions \(2\)/)).toBeTruthy();
		});
	});
});
