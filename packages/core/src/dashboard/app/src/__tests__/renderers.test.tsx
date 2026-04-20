import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdrRenderer } from "../renderers/AdrRenderer";
import { ChecklistRenderer } from "../renderers/ChecklistRenderer";
import { ErdRenderer } from "../renderers/ErdRenderer";
import { DocumentRenderer, getRenderer } from "../renderers/registry";
import { SprintPlanRenderer } from "../renderers/SprintPlanRenderer";
import { ThreatModelRenderer } from "../renderers/ThreatModelRenderer";

describe("Renderer Registry", () => {
	it("returns DocumentRenderer as default for unknown artifact types", () => {
		const Renderer = getRenderer("unknown-file.json");
		expect(Renderer).toBe(DocumentRenderer);
	});

	it("returns specialized renderers for known artifact types", () => {
		expect(getRenderer("sprint-plan.json")).toBe(SprintPlanRenderer);
		expect(getRenderer("threat-model.json")).toBe(ThreatModelRenderer);
		expect(getRenderer("dod-checklist.json")).toBe(ChecklistRenderer);
		expect(getRenderer("erd.json")).toBe(ErdRenderer);
		expect(getRenderer("adrs.json")).toBe(AdrRenderer);
	});

	it("returns DocumentRenderer for types without specialized renderer", () => {
		expect(getRenderer("frd.json")).toBe(DocumentRenderer);
		expect(getRenderer("architecture.json")).toBe(DocumentRenderer);
		expect(getRenderer("nfr.json")).toBe(DocumentRenderer);
	});
});

describe("DocumentRenderer", () => {
	it("renders top-level string fields as labeled paragraphs", () => {
		const data = {
			projectName: "My Project",
			version: "1.0.0",
		};
		render(<DocumentRenderer data={data} filename="frd.json" />);
		expect(screen.getByText("Project Name")).toBeInTheDocument();
		expect(screen.getByText("My Project")).toBeInTheDocument();
		expect(screen.getByText("Version")).toBeInTheDocument();
		expect(screen.getByText("1.0.0")).toBeInTheDocument();
	});

	it("renders arrays of strings as bullet lists", () => {
		const data = {
			assumptions: ["Users have internet", "Browser supports ES2022"],
		};
		render(<DocumentRenderer data={data} filename="test.json" />);
		expect(screen.getByText("Assumptions")).toBeInTheDocument();
		expect(screen.getByText("Users have internet")).toBeInTheDocument();
		expect(screen.getByText("Browser supports ES2022")).toBeInTheDocument();
	});

	it("renders arrays of objects as card sections", () => {
		const data = {
			epics: [
				{ id: "E1", title: "Auth Module", description: "Login flow" },
				{ id: "E2", title: "Dashboard", description: "Main view" },
			],
		};
		render(<DocumentRenderer data={data} filename="frd.json" />);
		expect(screen.getByText("Epics")).toBeInTheDocument();
		expect(screen.getByText("Auth Module")).toBeInTheDocument();
		expect(screen.getByText("Dashboard")).toBeInTheDocument();
		expect(screen.getByText("Login flow")).toBeInTheDocument();
	});

	it("renders nested objects as subsections", () => {
		const data = {
			performance: {
				responseTime: "200ms",
				throughput: "1000 rps",
			},
		};
		render(<DocumentRenderer data={data} filename="nfr.json" />);
		expect(screen.getByText("Performance")).toBeInTheDocument();
		expect(screen.getByText("Response Time")).toBeInTheDocument();
		expect(screen.getByText("200ms")).toBeInTheDocument();
	});

	it("renders number and boolean values inline", () => {
		const data = {
			totalPersonDays: 42,
			ready: true,
			score: 87,
		};
		render(<DocumentRenderer data={data} filename="estimate.json" />);
		expect(screen.getByText("42")).toBeInTheDocument();
		expect(screen.getByText("true")).toBeInTheDocument();
		expect(screen.getByText("87")).toBeInTheDocument();
	});

	it("renders deeply nested structures recursively", () => {
		const data = {
			epics: [
				{
					id: "E1",
					title: "Auth",
					userStories: [
						{
							id: "US-1",
							title: "Login",
							acceptanceCriteria: ["Email required", "Password min 8 chars"],
						},
					],
				},
			],
		};
		render(<DocumentRenderer data={data} filename="frd.json" />);
		expect(screen.getByText("Auth")).toBeInTheDocument();
		expect(screen.getByText("Login")).toBeInTheDocument();
		expect(screen.getByText("Email required")).toBeInTheDocument();
		expect(screen.getByText("Password min 8 chars")).toBeInTheDocument();
	});

	it("handles empty data gracefully", () => {
		render(<DocumentRenderer data={{}} filename="empty.json" />);
		expect(screen.getByText("No content")).toBeInTheDocument();
	});

	it("renders null and undefined values with placeholder", () => {
		const data = {
			completedAt: null,
			notes: undefined,
		};
		render(<DocumentRenderer data={data} filename="test.json" />);
		expect(screen.getByText("Completed At")).toBeInTheDocument();
	});

	it("humanizes camelCase keys into readable headings", () => {
		const data = {
			projectName: "Test",
			totalStoryPoints: 50,
			sprintDuration: "2 weeks",
		};
		render(<DocumentRenderer data={data} filename="plan.json" />);
		expect(screen.getByText("Project Name")).toBeInTheDocument();
		expect(screen.getByText("Total Story Points")).toBeInTheDocument();
		expect(screen.getByText("Sprint Duration")).toBeInTheDocument();
	});

	it("renders status/severity fields with visual styling", () => {
		const data = {
			threats: [
				{ id: "T1", title: "SQL Injection", severity: "critical" },
				{ id: "T2", title: "XSS", severity: "high" },
			],
		};
		render(<DocumentRenderer data={data} filename="threat-model.json" />);
		expect(screen.getByText("critical")).toBeInTheDocument();
		expect(screen.getByText("high")).toBeInTheDocument();
	});

	it("renders the filename as document title", () => {
		const data = { projectName: "Test" };
		render(<DocumentRenderer data={data} filename="frd.json" />);
		expect(screen.getByText("frd.json")).toBeInTheDocument();
	});
});

describe("SprintPlanRenderer", () => {
	const sprintData = {
		projectName: "Demo",
		sprintDuration: "2 weeks",
		totalStoryPoints: 34,
		sprints: [
			{
				id: "S1",
				name: "Sprint 1",
				goal: "Core auth",
				stories: [
					{
						id: "US-1",
						title: "Login page",
						storyPoints: 5,
						priority: "high",
						tasks: [
							{
								id: "T1",
								title: "Build form",
								estimateHours: 4,
								status: "done",
							},
							{
								id: "T2",
								title: "Add validation",
								estimateHours: 3,
								status: "pending",
							},
						],
					},
				],
			},
		],
	};

	it("renders sprint name and goal", () => {
		render(
			<SprintPlanRenderer data={sprintData} filename="sprint-plan.json" />,
		);
		expect(screen.getByText("Sprint 1")).toBeInTheDocument();
		expect(screen.getByText("Core auth")).toBeInTheDocument();
	});

	it("renders stories as table rows", () => {
		render(
			<SprintPlanRenderer data={sprintData} filename="sprint-plan.json" />,
		);
		expect(screen.getByText("Login page")).toBeInTheDocument();
		expect(screen.getByText("5")).toBeInTheDocument();
	});

	it("renders task list under stories", () => {
		render(
			<SprintPlanRenderer data={sprintData} filename="sprint-plan.json" />,
		);
		expect(screen.getByText("Build form")).toBeInTheDocument();
		expect(screen.getByText("Add validation")).toBeInTheDocument();
	});

	it("shows total story points", () => {
		render(
			<SprintPlanRenderer data={sprintData} filename="sprint-plan.json" />,
		);
		expect(screen.getByText(/34/)).toBeInTheDocument();
	});
});

describe("ThreatModelRenderer", () => {
	const threatData = {
		threats: [
			{
				id: "T1",
				title: "SQL Injection",
				category: "injection",
				severity: "critical",
				description: "Unsanitized input",
				mitigation: "Use parameterized queries",
			},
			{
				id: "T2",
				title: "XSS",
				category: "injection",
				severity: "high",
				description: "Script injection",
				mitigation: "Escape output",
			},
			{
				id: "T3",
				title: "CSRF",
				category: "session",
				severity: "medium",
				description: "Cross-site request",
				mitigation: "CSRF tokens",
			},
		],
	};

	it("renders threat titles", () => {
		render(
			<ThreatModelRenderer data={threatData} filename="threat-model.json" />,
		);
		expect(screen.getByText("SQL Injection")).toBeInTheDocument();
		expect(screen.getByText("XSS")).toBeInTheDocument();
		expect(screen.getByText("CSRF")).toBeInTheDocument();
	});

	it("shows severity badges with color coding", () => {
		render(
			<ThreatModelRenderer data={threatData} filename="threat-model.json" />,
		);
		expect(screen.getByText("critical")).toBeInTheDocument();
		expect(screen.getByText("high")).toBeInTheDocument();
		expect(screen.getByText("medium")).toBeInTheDocument();
	});

	it("shows mitigation details", () => {
		render(
			<ThreatModelRenderer data={threatData} filename="threat-model.json" />,
		);
		expect(screen.getByText("Use parameterized queries")).toBeInTheDocument();
	});
});

describe("ChecklistRenderer", () => {
	const checklistData = {
		items: [
			{
				id: "C1",
				title: "Unit tests pass",
				category: "testing",
				required: true,
			},
			{ id: "C2", title: "Code reviewed", category: "review", required: true },
			{ id: "C3", title: "Docs updated", category: "docs", required: false },
		],
	};

	it("renders checklist items", () => {
		render(
			<ChecklistRenderer data={checklistData} filename="dod-checklist.json" />,
		);
		expect(screen.getByText("Unit tests pass")).toBeInTheDocument();
		expect(screen.getByText("Code reviewed")).toBeInTheDocument();
		expect(screen.getByText("Docs updated")).toBeInTheDocument();
	});

	it("shows required badge for required items", () => {
		render(
			<ChecklistRenderer data={checklistData} filename="dod-checklist.json" />,
		);
		const requiredBadges = screen.getAllByText("required");
		expect(requiredBadges.length).toBe(2);
	});

	it("groups items by category", () => {
		render(
			<ChecklistRenderer data={checklistData} filename="dod-checklist.json" />,
		);
		expect(screen.getByText("Testing")).toBeInTheDocument();
		expect(screen.getByText("Review")).toBeInTheDocument();
		expect(screen.getByText("Docs")).toBeInTheDocument();
	});
});

describe("ErdRenderer", () => {
	const erdData = {
		entities: [
			{
				name: "User",
				attributes: [
					{ name: "id", type: "uuid", primaryKey: true, nullable: false },
					{
						name: "email",
						type: "varchar(255)",
						primaryKey: false,
						nullable: false,
					},
					{ name: "bio", type: "text", primaryKey: false, nullable: true },
				],
			},
			{
				name: "Post",
				attributes: [
					{ name: "id", type: "uuid", primaryKey: true, nullable: false },
					{
						name: "title",
						type: "varchar(255)",
						primaryKey: false,
						nullable: false,
					},
				],
			},
		],
		relationships: [{ from: "User", to: "Post", cardinality: "1:N" }],
	};

	it("renders entity names", () => {
		render(<ErdRenderer data={erdData} filename="erd.json" />);
		// "User" and "Post" appear in entity headers and relationship section
		expect(screen.getAllByText("User").length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText("Post").length).toBeGreaterThanOrEqual(1);
	});

	it("shows attribute names and types", () => {
		render(<ErdRenderer data={erdData} filename="erd.json" />);
		expect(screen.getByText("email")).toBeInTheDocument();
		// varchar(255) appears twice (for email and title)
		expect(screen.getAllByText("varchar(255)").length).toBeGreaterThanOrEqual(
			1,
		);
	});

	it("marks primary keys", () => {
		render(<ErdRenderer data={erdData} filename="erd.json" />);
		const pkBadges = screen.getAllByText("PK");
		expect(pkBadges.length).toBe(2);
	});

	it("shows relationships", () => {
		render(<ErdRenderer data={erdData} filename="erd.json" />);
		expect(screen.getByText("1:N")).toBeInTheDocument();
		expect(screen.getByText("Relationships")).toBeInTheDocument();
	});
});

describe("AdrRenderer", () => {
	const adrData = {
		id: "ADR-001",
		title: "Use PostgreSQL for persistence",
		status: "accepted",
		context: "We need a reliable RDBMS",
		decision: "Use PostgreSQL 16",
		consequences: ["Need DBA expertise", "Strong ACID guarantees"],
		date: "2026-01-15",
	};

	it("renders ADR title and ID", () => {
		render(<AdrRenderer data={adrData} filename="adrs.json" />);
		expect(
			screen.getByText("Use PostgreSQL for persistence"),
		).toBeInTheDocument();
		expect(screen.getByText("ADR-001")).toBeInTheDocument();
	});

	it("shows status badge", () => {
		render(<AdrRenderer data={adrData} filename="adrs.json" />);
		expect(screen.getByText("accepted")).toBeInTheDocument();
	});

	it("renders context and decision sections", () => {
		render(<AdrRenderer data={adrData} filename="adrs.json" />);
		expect(screen.getByText("Context")).toBeInTheDocument();
		expect(screen.getByText("We need a reliable RDBMS")).toBeInTheDocument();
		expect(screen.getByText("Decision")).toBeInTheDocument();
		expect(screen.getByText("Use PostgreSQL 16")).toBeInTheDocument();
	});

	it("renders consequences as list", () => {
		render(<AdrRenderer data={adrData} filename="adrs.json" />);
		expect(screen.getByText("Need DBA expertise")).toBeInTheDocument();
		expect(screen.getByText("Strong ACID guarantees")).toBeInTheDocument();
	});
});
