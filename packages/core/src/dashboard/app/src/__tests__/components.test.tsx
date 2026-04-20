import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopyButton } from "../components/ui/CopyButton";
import { EmptyState } from "../components/ui/EmptyState";
import { MetricCard } from "../components/ui/MetricCard";
import { StatusBadge } from "../components/ui/StatusBadge";

describe("StatusBadge", () => {
	it("renders status text", () => {
		render(<StatusBadge status="running" />);
		expect(screen.getByText("running")).toBeInTheDocument();
	});

	it("applies green styling for succeeded", () => {
		const { container } = render(<StatusBadge status="succeeded" />);
		const el = container.firstElementChild;
		expect(el?.className).toContain("good");
	});

	it("applies red styling for failed", () => {
		const { container } = render(<StatusBadge status="failed" />);
		const el = container.firstElementChild;
		expect(el?.className).toContain("bad");
	});

	it("applies yellow styling for running", () => {
		const { container } = render(<StatusBadge status="running" />);
		const el = container.firstElementChild;
		expect(el?.className).toContain("warn");
	});

	it("normalizes underscores in status text", () => {
		render(<StatusBadge status="paused_at_gate" />);
		expect(screen.getByText("paused at gate")).toBeInTheDocument();
	});
});

describe("MetricCard", () => {
	it("renders label and value", () => {
		render(<MetricCard label="Pipelines" value={12} />);
		expect(screen.getByText("Pipelines")).toBeInTheDocument();
		expect(screen.getByText("12")).toBeInTheDocument();
	});

	it("renders string values", () => {
		render(<MetricCard label="Cost" value="$4.23" />);
		expect(screen.getByText("$4.23")).toBeInTheDocument();
	});
});

describe("EmptyState", () => {
	it("renders message", () => {
		render(<EmptyState message="No pipelines found." />);
		expect(screen.getByText("No pipelines found.")).toBeInTheDocument();
	});
});

describe("CopyButton", () => {
	it("renders with copy icon", () => {
		const { container } = render(<CopyButton text="test-id" />);
		expect(container.querySelector("button")).toBeInTheDocument();
	});
});
