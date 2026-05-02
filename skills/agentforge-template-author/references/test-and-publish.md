# Test and publish a template

Every shipped template needs a test that proves the YAML files parse, plus
the standard PR review pass. Untested templates do not merge.

## Required tests

### 1. Parse test

Asserts every `.agent.yaml`, `.pipeline.yaml`, and `.node.yaml` in the
template parses against the Zod schemas in
`packages/core/src/definitions/parser.ts`. Pattern from existing templates:

```typescript
// packages/<core|platform>/tests/templates/<name>.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  AgentDefinitionSchema,
  PipelineDefinitionSchema,
  NodeDefinitionSchema,
} from "../../src/definitions/parser.js";

const TEMPLATE_DIR = join(import.meta.dirname, "..", "..", "src", "templates", "<name>");

describe("<name> template", () => {
  it("agents parse", async () => {
    for await (const file of glob(`${TEMPLATE_DIR}/agents/*.agent.yaml`)) {
      const raw = parseYaml(readFileSync(file, "utf8"));
      expect(() => AgentDefinitionSchema.parse(raw)).not.toThrow();
    }
  });

  it("pipeline parses", () => {
    const file = `${TEMPLATE_DIR}/pipelines/<name>.pipeline.yaml`;
    const raw = parseYaml(readFileSync(file, "utf8"));
    expect(() => PipelineDefinitionSchema.parse(raw)).not.toThrow();
  });

  it("nodes parse", async () => {
    for await (const file of glob(`${TEMPLATE_DIR}/nodes/*.node.yaml`)) {
      const raw = parseYaml(readFileSync(file, "utf8"));
      expect(() => NodeDefinitionSchema.parse(raw)).not.toThrow();
    }
  });

  it("registry discovers it", async () => {
    const { getCoreTemplates } = await import("../../src/templates/registry.js");
    const t = getCoreTemplates().find((x) => x.name === "<name>");
    expect(t).toBeDefined();
    expect(t?.agents).toBeGreaterThan(0);
  });
});
```

For platform templates, swap the import to
`@mandarnilange/agentforge-core` (read-only) for the schemas, and the
registry import to the platform registry.

### 2. Manifest validation

The registry's `isValidManifest` runs at startup. Make sure the test
exercises a fresh registry load via `clearCoreTemplatesCache()`:

```typescript
import { clearCoreTemplatesCache, getCoreTemplates } from "../../src/templates/registry.js";

beforeEach(() => clearCoreTemplatesCache());
```

Otherwise a stale cache from earlier tests can mask manifest errors.

### 3. End-to-end smoke (optional, recommended)

Run the template through `init` → `validate` → first agent execution
against a mocked LLM. This catches schema/wiring mismatches that pass the
parse test but break at runtime. See
`packages/core/tests/cli/init.test.ts` for the init pattern and
`packages/core/tests/runner/agent-runner.test.ts` for mocked-LLM execution.

## Local checks before opening the PR

```bash
# 1. Lint and format
npm run lint

# 2. Type check
npm run typecheck

# 3. Run all tests (template + everything else)
npm test

# 4. Smoke-test the scaffold
mkdir -p /tmp/agentforge-template-test && cd /tmp/agentforge-template-test
npx tsx <repo>/packages/core/src/cli/index.ts init --template <name>
ls -R .agentforge/

# 5. Validate the scaffolded definitions
npx tsx <repo>/packages/core/src/cli/index.ts list
```

If `list` shows the template's agents and `init` produced a complete
`.agentforge/` directory, the publish flow is working.

## PR checklist

Copy this into the PR description:

- [ ] New directory `packages/<core|platform>/src/templates/<name>/`
- [ ] `template.json` validates against `isValidManifest`
- [ ] `agents/`, `pipelines/`, `nodes/`, `prompts/`, `schemas/`, `README.md`
- [ ] Parse test added at `packages/<core|platform>/tests/templates/<name>.test.ts`
- [ ] `npm test` passes locally
- [ ] `npm run lint` clean
- [ ] `docs/templates.md` updated with the catalog entry (table row + dedicated section)
- [ ] Smoke-tested: `npx tsx packages/core/src/cli/index.ts init --template <name>` produces a complete `.agentforge/` directory
- [ ] No cross-package imports (core → platform, or platform → end-user code)
- [ ] All output `type`s either reuse a shipped schema or have a new schema file in the template's `schemas/` directory

## Versioning

Templates do not have their own version field — they ship with the package
version. Breaking changes to a shipped template (renamed agent, changed
output type) require a major package bump. Keep that bar high.

For evolving an existing template:
- Adding an optional new agent to an existing phase: minor bump.
- Adding a new output `type`: minor bump.
- Renaming an agent or removing one: major bump.
- Changing the `template.json` `name`: major bump (the install command
  changes for end users).

If you are adding a *brand new* template, you do not need a version bump —
new template = additive change.
