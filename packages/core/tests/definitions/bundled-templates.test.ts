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
import { parseDefinitionFile } from "../../src/definitions/parser.js";

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
