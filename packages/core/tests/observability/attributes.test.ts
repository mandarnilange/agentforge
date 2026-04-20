import { describe, expect, it } from "vitest";
import * as attrs from "../../src/observability/attributes.js";

describe("AgentForge attribute constants", () => {
	it("should export pipeline attribute names", () => {
		expect(attrs.AGENTFORGE_PIPELINE_ID).toBe("agentforge.pipeline.id");
		expect(attrs.AGENTFORGE_PIPELINE_NAME).toBe("agentforge.pipeline.name");
	});

	it("should export agent attribute names", () => {
		expect(attrs.AGENTFORGE_AGENT_NAME).toBe("agentforge.agent.name");
		expect(attrs.AGENTFORGE_AGENT_RUN_ID).toBe("agentforge.agent.run_id");
		expect(attrs.AGENTFORGE_AGENT_EXECUTOR).toBe("agentforge.agent.executor");
	});

	it("should export phase attribute name", () => {
		expect(attrs.AGENTFORGE_PHASE).toBe("agentforge.phase");
	});

	it("should export step attribute names", () => {
		expect(attrs.AGENTFORGE_STEP_NAME).toBe("agentforge.agent.step.name");
		expect(attrs.AGENTFORGE_STEP_TYPE).toBe("agentforge.agent.step.type");
	});

	it("should export project attribute name", () => {
		expect(attrs.AGENTFORGE_PROJECT_NAME).toBe("agentforge.project.name");
	});
});
