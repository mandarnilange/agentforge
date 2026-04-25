/**
 * Validate every bundled `*.node.yaml` against NodeDefinitionSchema so we
 * never ship a template that fails `agentforge apply`. Caught a real bug
 * during pre-release validation: 11 of 11 node templates used the wrong
 * shape and apply-on-template threw a ZodError mid-flow.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	loadDefinitionsFromDir,
	parseDefinitionFile,
} from "../../src/definitions/parser.js";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const TEMPLATE_DIRS = [
	join(REPO_ROOT, "packages/core/src/templates"),
	join(REPO_ROOT, "packages/platform/src/templates"),
];

function findNodeYamls(dir: string): string[] {
	const out: string[] = [];
	const visit = (d: string): void => {
		for (const entry of readdirSync(d)) {
			const path = join(d, entry);
			if (statSync(path).isDirectory()) {
				visit(path);
			} else if (entry.endsWith(".node.yaml")) {
				out.push(path);
			}
		}
	};
	try {
		visit(dir);
	} catch {
		// Directory missing in some test environments — skip.
	}
	return out;
}

describe("loadDefinitionsFromDir — recursive + tolerant", () => {
	const apiBuilder = join(
		REPO_ROOT,
		"packages/platform/src/templates/api-builder",
	);

	it("loads agents/pipelines/nodes from a template root in one call", () => {
		const loaded = loadDefinitionsFromDir(apiBuilder);
		// api-builder ships 4 agents, 1 pipeline, 2 nodes — see find listing
		// in packages/platform/src/templates/api-builder/.
		expect(loaded.agents.map((a) => a.metadata.name).sort()).toEqual([
			"code-generator",
			"doc-writer",
			"spec-writer",
			"test-generator",
		]);
		expect(loaded.pipelines.map((p) => p.metadata.name)).toEqual([
			"api-builder",
		]);
		expect(loaded.nodes.map((n) => n.metadata.name).sort()).toEqual([
			"docker-runner",
			"local",
		]);
	});

	it("ignores schemas/*.schema.yaml — they are JSON-Schema docs, not definitions", () => {
		// If recursion picked them up via parseDefinitionFile, parseDefinitionFile
		// would throw on the missing `kind` field. The fact that the call above
		// succeeds proves they're being filtered before parse.
		const loaded = loadDefinitionsFromDir(apiBuilder);
		// Sanity: at least one schemas/*.schema.yaml exists for this assertion
		// to be meaningful.
		const schemas = readdirSync(join(apiBuilder, "schemas"));
		expect(schemas.some((f) => f.endsWith(".schema.yaml"))).toBe(true);
		// Nothing schema-shaped sneaked into agents.
		expect(loaded.agents.every((a) => a.kind === "AgentDefinition")).toBe(true);
	});
});

describe("Bundled NodeDefinition templates parse cleanly", () => {
	const yamls = TEMPLATE_DIRS.flatMap(findNodeYamls);

	it("locates at least one bundled .node.yaml", () => {
		expect(yamls.length).toBeGreaterThan(0);
	});

	for (const path of yamls) {
		const rel = path.slice(REPO_ROOT.length + 1);
		it(`accepts ${rel}`, () => {
			const _content = readFileSync(path, "utf-8");
			expect(() => parseDefinitionFile(path)).not.toThrow();
		});
	}
});
