import { describe, expect, it } from "vitest";
import { DependencyMapSchema } from "../../src/schemas/dependency-map.schema.js";
import { DodChecklistSchema } from "../../src/schemas/dod-checklist.schema.js";
import { getSchemaForType } from "../../src/schemas/index.js";
import { RiskRegisterSchema } from "../../src/schemas/risk-register.schema.js";
import { SprintPlanSchema } from "../../src/schemas/sprint-plan.schema.js";

// --- Sprint Plan Schema ---

const validSprintPlan = {
	projectName: "FreelanceFlow",
	sprintDuration: "2 weeks",
	sprints: [
		{
			id: "SPRINT-001",
			name: "Sprint 1 — Foundation",
			goal: "Set up project scaffolding, auth, and basic user management",
			duration: "2 weeks",
			stories: [
				{
					id: "US-001",
					title: "User registration",
					epicId: "EPIC-001",
					storyPoints: 5,
					tasks: [
						{
							id: "TASK-001",
							title: "Implement registration API endpoint",
							estimateHours: 8,
							assignee: "backend",
							status: "todo",
						},
						{
							id: "TASK-002",
							title: "Build registration form UI",
							estimateHours: 6,
							assignee: "frontend",
							status: "todo",
						},
					],
				},
			],
		},
		{
			id: "SPRINT-002",
			name: "Sprint 2 — Core Features",
			goal: "Implement project creation and invoice generation",
			duration: "2 weeks",
			stories: [
				{
					id: "US-003",
					title: "Create new project",
					epicId: "EPIC-002",
					storyPoints: 8,
					tasks: [
						{
							id: "TASK-005",
							title: "Project CRUD API",
							estimateHours: 12,
							assignee: "backend",
							status: "todo",
						},
					],
				},
			],
		},
	],
};

describe("SprintPlanSchema", () => {
	it("accepts a valid sprint plan", () => {
		const result = SprintPlanSchema.safeParse(validSprintPlan);
		expect(result.success).toBe(true);
	});

	it("accepts minimal sprint plan (only required fields)", () => {
		const minimal = {
			sprints: [
				{
					id: "SPRINT-001",
					goal: "Set up foundation",
					stories: [
						{
							id: "US-001",
							title: "User registration",
							tasks: [
								{
									id: "TASK-001",
									title: "Implement endpoint",
									estimateHours: 4,
								},
							],
						},
					],
				},
			],
		};
		const result = SprintPlanSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects sprint plan missing sprints", () => {
		const { sprints, ...rest } = validSprintPlan;
		const result = SprintPlanSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects sprint plan with empty sprints array", () => {
		const result = SprintPlanSchema.safeParse({
			...validSprintPlan,
			sprints: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects sprint with no stories", () => {
		const result = SprintPlanSchema.safeParse({
			sprints: [
				{
					id: "SPRINT-001",
					goal: "Something",
					stories: [],
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects story with no tasks", () => {
		const result = SprintPlanSchema.safeParse({
			sprints: [
				{
					id: "SPRINT-001",
					goal: "Something",
					stories: [
						{
							id: "US-001",
							title: "A story",
							tasks: [],
						},
					],
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects task missing estimateHours", () => {
		const result = SprintPlanSchema.safeParse({
			sprints: [
				{
					id: "SPRINT-001",
					goal: "Something",
					stories: [
						{
							id: "US-001",
							title: "A story",
							tasks: [
								{
									id: "TASK-001",
									title: "Missing estimate",
								},
							],
						},
					],
				},
			],
		});
		expect(result.success).toBe(false);
	});
});

// --- Dependency Map Schema ---

const validDependencyMap = {
	nodes: [
		{
			id: "COMP-001",
			name: "API Gateway",
			type: "service",
		},
		{
			id: "COMP-002",
			name: "User Service",
			type: "service",
		},
		{
			id: "COMP-003",
			name: "Database",
			type: "database",
		},
	],
	edges: [
		{
			from: "COMP-001",
			to: "COMP-002",
			type: "needs",
			description: "Routes auth requests",
		},
		{
			from: "COMP-002",
			to: "COMP-003",
			type: "needs",
			description: "Stores user data",
		},
	],
};

describe("DependencyMapSchema", () => {
	it("accepts a valid dependency map", () => {
		const result = DependencyMapSchema.safeParse(validDependencyMap);
		expect(result.success).toBe(true);
	});

	it("accepts minimal dependency map", () => {
		const minimal = {
			nodes: [{ id: "A", name: "Service A" }],
			edges: [{ from: "A", to: "B", type: "blocks" }],
		};
		const result = DependencyMapSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects dependency map missing nodes", () => {
		const { nodes, ...rest } = validDependencyMap;
		const result = DependencyMapSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects dependency map missing edges", () => {
		const { edges, ...rest } = validDependencyMap;
		const result = DependencyMapSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects empty nodes array", () => {
		const result = DependencyMapSchema.safeParse({
			...validDependencyMap,
			nodes: [],
		});
		expect(result.success).toBe(false);
	});

	it("accepts edge types: blocks, needs, feeds", () => {
		for (const type of ["blocks", "needs", "feeds"]) {
			const map = {
				nodes: [{ id: "A", name: "A" }],
				edges: [{ from: "A", to: "B", type }],
			};
			const result = DependencyMapSchema.safeParse(map);
			expect(result.success).toBe(true);
		}
	});

	it("rejects invalid edge type", () => {
		const map = {
			nodes: [{ id: "A", name: "A" }],
			edges: [{ from: "A", to: "B", type: "invalid-type" }],
		};
		const result = DependencyMapSchema.safeParse(map);
		expect(result.success).toBe(false);
	});
});

// --- Risk Register Schema ---

const validRiskRegister = {
	risks: [
		{
			id: "RISK-001",
			title: "Third-party payment API instability",
			description:
				"Stripe API may have intermittent outages affecting invoice payments",
			likelihood: "medium",
			impact: "high",
			mitigation:
				"Implement retry logic with exponential backoff and fallback to manual invoicing",
			owner: "backend-team",
			status: "open",
		},
		{
			id: "RISK-002",
			title: "Team unfamiliarity with Fastify",
			description: "Team has limited experience with Fastify framework",
			likelihood: "high",
			impact: "medium",
			mitigation: "Schedule a 2-day Fastify workshop before Sprint 1",
			owner: "tech-lead",
			status: "mitigated",
		},
	],
};

describe("RiskRegisterSchema", () => {
	it("accepts a valid risk register", () => {
		const result = RiskRegisterSchema.safeParse(validRiskRegister);
		expect(result.success).toBe(true);
	});

	it("accepts minimal risk", () => {
		const minimal = {
			risks: [
				{
					id: "RISK-001",
					title: "A risk",
					likelihood: "low",
					impact: "low",
					mitigation: "Do something about it",
				},
			],
		};
		const result = RiskRegisterSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects risk register missing risks", () => {
		const result = RiskRegisterSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects empty risks array", () => {
		const result = RiskRegisterSchema.safeParse({ risks: [] });
		expect(result.success).toBe(false);
	});

	it("rejects risk with invalid likelihood", () => {
		const result = RiskRegisterSchema.safeParse({
			risks: [
				{
					id: "RISK-001",
					title: "Bad risk",
					likelihood: "extreme",
					impact: "low",
					mitigation: "Something",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects risk with invalid impact", () => {
		const result = RiskRegisterSchema.safeParse({
			risks: [
				{
					id: "RISK-001",
					title: "Bad risk",
					likelihood: "low",
					impact: "extreme",
					mitigation: "Something",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("rejects risk with invalid status", () => {
		const result = RiskRegisterSchema.safeParse({
			risks: [
				{
					id: "RISK-001",
					title: "Bad risk",
					likelihood: "low",
					impact: "low",
					mitigation: "Something",
					status: "unknown",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("accepts all valid likelihood values", () => {
		for (const likelihood of ["low", "medium", "high"]) {
			const result = RiskRegisterSchema.safeParse({
				risks: [
					{
						id: "RISK-001",
						title: "Test",
						likelihood,
						impact: "low",
						mitigation: "Fix it",
					},
				],
			});
			expect(result.success).toBe(true);
		}
	});

	it("accepts all valid status values", () => {
		for (const status of ["open", "mitigated", "accepted"]) {
			const result = RiskRegisterSchema.safeParse({
				risks: [
					{
						id: "RISK-001",
						title: "Test",
						likelihood: "low",
						impact: "low",
						mitigation: "Fix it",
						status,
					},
				],
			});
			expect(result.success).toBe(true);
		}
	});
});

// --- DoD Checklist Schema ---

const validDodChecklist = {
	items: [
		{
			id: "DOD-001",
			category: "code-quality",
			description: "All code passes linting with zero warnings",
			required: true,
		},
		{
			id: "DOD-002",
			category: "testing",
			description: "Unit test coverage above 80%",
			required: true,
		},
		{
			id: "DOD-003",
			category: "documentation",
			description: "API endpoints documented in OpenAPI spec",
			required: false,
		},
	],
};

describe("DodChecklistSchema", () => {
	it("accepts a valid DoD checklist", () => {
		const result = DodChecklistSchema.safeParse(validDodChecklist);
		expect(result.success).toBe(true);
	});

	it("accepts minimal DoD checklist", () => {
		const minimal = {
			items: [
				{
					id: "DOD-001",
					description: "Tests pass",
				},
			],
		};
		const result = DodChecklistSchema.safeParse(minimal);
		expect(result.success).toBe(true);
	});

	it("rejects DoD checklist missing items", () => {
		const result = DodChecklistSchema.safeParse({});
		expect(result.success).toBe(false);
	});

	it("rejects empty items array", () => {
		const result = DodChecklistSchema.safeParse({ items: [] });
		expect(result.success).toBe(false);
	});
});

// --- Schema Registry — Planner types ---

const TRACKX_ARTIFACT_TYPES = [
	"sprint-plan",
	"dependency-map",
	"risk-register",
	"dod-checklist",
] as const;

describe("Schema Registry — Planner types", () => {
	it.each(
		TRACKX_ARTIFACT_TYPES,
	)("returns a schema for artifact type '%s'", (type) => {
		const schema = getSchemaForType(type);
		expect(schema).toBeDefined();
		expect(schema).toBeDefined();
		expect(typeof schema?.safeParse).toBe("function");
	});
});
