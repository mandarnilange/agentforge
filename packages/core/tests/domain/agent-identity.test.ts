import { describe, expect, it } from "vitest";
import type {
	AgentJob,
	AgentJobIdentity,
} from "../../src/domain/ports/agent-executor.port.js";

describe("AgentJobIdentity (P18-T15)", () => {
	it("should express allowed input and output types", () => {
		const identity: AgentJobIdentity = {
			agentId: "developer",
			pipelineRunId: "run-001",
			phase: 4,
			allowedInputTypes: ["architecture", "sprint-plan"],
			allowedOutputTypes: ["api-code", "openapi-spec"],
		};

		expect(identity.allowedInputTypes).toContain("architecture");
		expect(identity.allowedOutputTypes).toContain("api-code");
		expect(identity.secretRefs).toBeUndefined();
	});

	it("should support secret references", () => {
		const identity: AgentJobIdentity = {
			agentId: "devops",
			pipelineRunId: "run-001",
			phase: 6,
			allowedInputTypes: ["cicd-config"],
			allowedOutputTypes: ["deployment-runbook"],
			secretRefs: ["DEPLOY_KEY", "REGISTRY_TOKEN"],
		};

		expect(identity.secretRefs).toHaveLength(2);
		expect(identity.secretRefs).toContain("DEPLOY_KEY");
	});

	it("should be attachable to AgentJob", () => {
		const job: AgentJob = {
			runId: "run-001",
			agentId: "developer",
			agentDefinition: {
				metadata: { name: "developer" },
				spec: { executor: "pi-coding-agent" },
			},
			inputs: [],
			workdir: "/tmp/work",
			outputDir: "/tmp/out",
			model: {
				provider: "anthropic",
				name: "claude-sonnet-4",
				maxTokens: 64000,
			},
			identity: {
				agentId: "developer",
				pipelineRunId: "run-001",
				phase: 4,
				allowedInputTypes: ["architecture"],
				allowedOutputTypes: ["api-code"],
			},
		};

		expect(job.identity).toBeDefined();
		expect(job.identity?.agentId).toBe("developer");
		expect(job.identity?.allowedInputTypes).toEqual(["architecture"]);
	});
});
