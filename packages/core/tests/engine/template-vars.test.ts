import { describe, expect, it } from "vitest";
import {
	resolveTemplate,
	type TemplateContext,
} from "../../src/engine/template-vars.js";

function makeCtx(overrides: Partial<TemplateContext> = {}): TemplateContext {
	return {
		run: {
			id: "run-001",
			workdir: "/tmp/work",
			agent: "developer",
			phase: "4",
			status: "running",
		},
		pipeline: { id: "pipe-001", name: "full-sdlc" },
		project: {
			name: "my-project",
			repo: "https://github.com/org/repo",
			repoPath: "/tmp/repo",
		},
		steps: {},
		env: { NODE_ENV: "test" },
		...overrides,
	};
}

describe("resolveTemplate", () => {
	it("resolves {{run.id}}", () => {
		expect(resolveTemplate("id={{run.id}}", makeCtx())).toBe("id=run-001");
	});

	it("resolves {{pipeline.id}} and {{pipeline.name}}", () => {
		const ctx = makeCtx();
		expect(resolveTemplate("{{pipeline.id}}-{{pipeline.name}}", ctx)).toBe(
			"pipe-001-full-sdlc",
		);
	});

	it("resolves {{project.name}}", () => {
		expect(resolveTemplate("project={{project.name}}", makeCtx())).toBe(
			"project=my-project",
		);
	});

	it("resolves {{steps.setup.output}}", () => {
		const ctx = makeCtx({
			steps: { setup: { output: "workspace ready", exitCode: 0 } },
		});
		expect(resolveTemplate("result={{steps.setup.output}}", ctx)).toBe(
			"result=workspace ready",
		);
	});

	it("resolves {{steps.setup.exitCode}}", () => {
		const ctx = makeCtx({
			steps: { setup: { output: "done", exitCode: 0 } },
		});
		expect(resolveTemplate("code={{steps.setup.exitCode}}", ctx)).toBe(
			"code=0",
		);
	});

	it("resolves {{env.NODE_ENV}}", () => {
		expect(resolveTemplate("env={{env.NODE_ENV}}", makeCtx())).toBe("env=test");
	});

	it("returns empty string for undefined variable", () => {
		expect(resolveTemplate("val={{nonexistent.path}}", makeCtx())).toBe("val=");
	});

	it("returns empty string for deeply undefined variable", () => {
		expect(resolveTemplate("val={{steps.missing.output}}", makeCtx())).toBe(
			"val=",
		);
	});

	it("handles multiple variables in one string", () => {
		const ctx = makeCtx();
		const result = resolveTemplate(
			"{{run.agent}} running in {{run.workdir}} for {{project.name}}",
			ctx,
		);
		expect(result).toBe("developer running in /tmp/work for my-project");
	});

	it("returns string unchanged when no templates present", () => {
		expect(resolveTemplate("no templates here", makeCtx())).toBe(
			"no templates here",
		);
	});

	it("handles template with run undefined gracefully", () => {
		const ctx = makeCtx({ run: undefined });
		expect(resolveTemplate("id={{run.id}}", ctx)).toBe("id=");
	});

	it("returns empty when traversing into a primitive value", () => {
		// run.id is a string; attempting to go deeper hits the typeof !== object branch
		expect(resolveTemplate("val={{run.id.further}}", makeCtx())).toBe("val=");
	});

	it("returns empty when the resolved value is explicitly null", () => {
		const ctx = makeCtx({
			// @ts-expect-error — deliberately poking a null to hit the final guard
			pipeline: null,
		});
		expect(resolveTemplate("{{pipeline.name}}", ctx)).toBe("");
	});

	it("resolves the loop.iteration variable when present", () => {
		const ctx = makeCtx({ loop: { iteration: 3, maxIterations: 5 } });
		expect(resolveTemplate("i={{loop.iteration}}", ctx)).toBe("i=3");
	});
});
