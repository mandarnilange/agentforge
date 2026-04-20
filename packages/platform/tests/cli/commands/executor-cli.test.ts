import { describe, expect, it } from "vitest";
import { DockerAgentExecutor } from "../../../src/adapters/execution/docker-agent-executor.js";
import { RemoteAgentExecutor } from "../../../src/adapters/execution/remote-agent-executor.js";

describe("Executor CLI integration (P18-T13)", () => {
	describe("DockerAgentExecutor", () => {
		it("is a valid class", () => {
			expect(DockerAgentExecutor).toBeDefined();
		});
	});

	describe("RemoteAgentExecutor", () => {
		it("is a valid class", () => {
			expect(RemoteAgentExecutor).toBeDefined();
		});

		it("constructs with a URL", () => {
			const executor = new RemoteAgentExecutor("http://executor:8080");
			expect(executor.execute).toBeTypeOf("function");
		});
	});

	it.todo("platform executor factory with docker/remote modes");
});
