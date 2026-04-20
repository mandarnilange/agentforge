import { describe, expect, it } from "vitest";
import { FrdSchema } from "../../src/schemas/frd.schema.js";

const validFrd = {
	projectName: "Acme E-Commerce Platform",
	version: "1.0.0",
	epics: [
		{
			id: "E-001",
			title: "User Authentication",
			description: "Complete authentication and authorization system",
			userStories: [
				{
					id: "US-001",
					title: "User Registration",
					asA: "new visitor",
					iWant: "to create an account with email and password",
					soThat: "I can access personalized features",
					acceptanceCriteria: [
						"Email must be validated",
						"Password must be at least 8 characters",
						"Confirmation email is sent on success",
					],
					priority: "must-have" as const,
				},
				{
					id: "US-002",
					title: "Social Login",
					asA: "new visitor",
					iWant: "to sign in with Google or GitHub",
					soThat: "I can get started quickly without creating a new password",
					acceptanceCriteria: [
						"Google OAuth2 login works",
						"GitHub OAuth login works",
					],
					priority: "should-have" as const,
					dependencies: ["US-001"],
				},
			],
		},
	],
	businessRules: [
		"Users must verify email before placing orders",
		"Discounts cannot exceed 50% of the item price",
	],
	assumptions: ["Users have modern browsers (last 2 versions)"],
	constraints: ["Must comply with GDPR for EU users"],
	outOfScope: ["Mobile native app", "Crypto payment integration"],
};

describe("FrdSchema", () => {
	it("accepts a valid FRD document", () => {
		const result = FrdSchema.safeParse(validFrd);
		expect(result.success).toBe(true);
	});

	it("accepts FRD with optional fields omitted on user stories", () => {
		const frd = {
			...validFrd,
			epics: [
				{
					id: "E-001",
					title: "Auth",
					description: "Auth epic",
					userStories: [
						{
							id: "US-001",
							title: "Login",
							asA: "user",
							iWant: "to login",
							soThat: "I can use the app",
							acceptanceCriteria: ["Can login with email"],
							priority: "must-have" as const,
							// dependencies omitted — optional
						},
					],
				},
			],
		};
		const result = FrdSchema.safeParse(frd);
		expect(result.success).toBe(true);
	});

	it("rejects FRD missing projectName", () => {
		const { projectName, ...rest } = validFrd;
		const result = FrdSchema.safeParse(rest);
		expect(result.success).toBe(false);
	});

	it("rejects FRD with empty epics array", () => {
		const result = FrdSchema.safeParse({ ...validFrd, epics: [] });
		expect(result.success).toBe(false);
	});

	it("rejects epic with no user stories", () => {
		const frd = {
			...validFrd,
			epics: [
				{
					id: "E-001",
					title: "Empty",
					description: "No stories",
					userStories: [],
				},
			],
		};
		const result = FrdSchema.safeParse(frd);
		expect(result.success).toBe(false);
	});

	it("rejects user story with empty acceptance criteria", () => {
		const frd = {
			...validFrd,
			epics: [
				{
					id: "E-001",
					title: "Auth",
					description: "Auth epic",
					userStories: [
						{
							id: "US-001",
							title: "Login",
							asA: "user",
							iWant: "to login",
							soThat: "I can use the app",
							acceptanceCriteria: [],
							priority: "must-have",
						},
					],
				},
			],
		};
		const result = FrdSchema.safeParse(frd);
		expect(result.success).toBe(false);
	});

	it("rejects user story with invalid priority", () => {
		const frd = {
			...validFrd,
			epics: [
				{
					id: "E-001",
					title: "Auth",
					description: "Auth epic",
					userStories: [
						{
							id: "US-001",
							title: "Login",
							asA: "user",
							iWant: "to login",
							soThat: "I can use the app",
							acceptanceCriteria: ["Works"],
							priority: "nice-to-have",
						},
					],
				},
			],
		};
		const result = FrdSchema.safeParse(frd);
		expect(result.success).toBe(false);
	});

	it("accepts FRD with empty optional arrays", () => {
		const frd = {
			...validFrd,
			assumptions: [],
			constraints: [],
			outOfScope: [],
		};
		const result = FrdSchema.safeParse(frd);
		expect(result.success).toBe(true);
	});
});
