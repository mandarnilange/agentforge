# AgentForge Templates

> Part of the [AgentForge documentation](README.md).

Templates are pre-built agent pipelines for common workflows. Run `agentforge init --template <name>` to scaffold a complete `.agentforge/` directory and start running pipelines immediately.

## Available Templates

| Template | Package | Agents | Loops | Parallel | Nodes |
|----------|---------|--------|-------|----------|-------|
| [`simple-sdlc`](#simple-sdlc) | core | 3 | 1 | No | local, docker |
| [`api-builder`](#api-builder) | platform | 4 | 2 | Yes | local, docker |
| [`seo-review`](#seo-review) | platform | 4 | 0 | No | local |
| [`content-generation`](#content-generation) | platform | 5 | 1 | No | local |
| [`code-review`](#code-review) | platform | 4 | 0 | Yes | local, docker |
| [`data-pipeline`](#data-pipeline) | platform | 5 | 3 | No | local, docker, ecs |

List all available templates at any time:

```bash
agentforge templates list
```

---

## simple-sdlc

**Package**: `@mandarnilange/agentforge-core` — available without platform

Lightweight 3-agent SDLC pipeline. Takes a project brief, produces requirements, an architecture plan, and generated code.

```
[Brief] → Analyst → Architect → [Gate] → Developer → code-output
                                           (test-fix loop)
```

```bash
agentforge init --template simple-sdlc
agentforge run-pipeline simple-sdlc \
  --input brief="Build a REST API for a task manager with user auth"
```

[→ Template README](../packages/core/src/templates/simple-sdlc/README.md)

---

## api-builder

**Package**: `agentforge`

Produces a working API server, test suite, and documentation from a brief. Code Generator and Test Generator run in parallel — both against the same spec.

```
[Brief] → Spec Writer → [Gate] → Code Generator ─┐
                                                   ├─ → Doc Writer
                                 Test Generator ──┘
```

```bash
agentforge init --template api-builder
agentforge run-pipeline api-builder \
  --input brief="REST API for a booking system — venues, timeslots, reservations. JWT auth."
```

[→ Template README](../packages/platform/src/templates/api-builder/README.md)

---

## seo-review

**Package**: `agentforge`

Full site SEO audit. Each agent builds on the previous: technical issues → keyword gaps → content quality → prioritised action plan.

```
[Brief] → Crawler Analyst → Keyword Analyst → Content Auditor → [Gate] → SEO Strategist
```

```bash
agentforge init --template seo-review
agentforge run-pipeline seo-review \
  --input brief="Audit example.com — organic traffic dropped 20% last quarter. Primary keywords: project management software."
```

[→ Template README](../packages/platform/src/templates/seo-review/README.md)

---

## content-generation

**Package**: `agentforge`

Research-backed content factory with human approval gates at outline and final edit stages. Writer uses a self-review loop to reach quality threshold before passing to Editor.

```
[Brief] → Researcher → Outline Writer → [Gate] → Writer (self-review loop) → Editor → [Gate] → SEO Optimizer
```

```bash
agentforge init --template content-generation
agentforge run-pipeline content-generation \
  --input brief="Topic: cloud cost optimisation. Audience: startup CTOs. 1500 words. Tone: practical."
```

[→ Template README](../packages/platform/src/templates/content-generation/README.md)

---

## code-review

**Package**: `agentforge`

Automated code review with parallel quality and security analysis. Both reviewers use tools to read actual code and run static analysis / dependency scanning.

```
[Brief] → Scope Analyst → Quality Reviewer ─┐
                                              ├─ → Report Writer
                          Security Scanner ──┘
```

```bash
agentforge init --template code-review
agentforge run-pipeline code-review \
  --input brief="Review PR #42: adds JWT auth to Express API. Files: src/middleware/auth.ts, src/routes/users.ts"
```

[→ Template README](../packages/platform/src/templates/code-review/README.md)

---

## data-pipeline

**Package**: `agentforge`

End-to-end data engineering pipeline with three fix loops and cloud deployment config. Includes ECS Fargate node for cloud-native execution of large-volume workloads.

```
[Brief] → Schema Designer → [Gate] → ETL Builder → Validator → Transformer → [Gate] → Loader
                                      (test loop)   (check loop) (test loop)
```

```bash
agentforge init --template data-pipeline
agentforge run-pipeline data-pipeline \
  --input brief="Source: Salesforce CSV exports. Target: PostgreSQL data warehouse. Daily. AWS. 50k rows/day."
```

[→ Template README](../packages/platform/src/templates/data-pipeline/README.md)

---

## Creating Your Own Template

1. Create a directory under `packages/core/src/templates/<name>/` (core) or `packages/platform/src/templates/<name>/` (platform)

2. Add a `template.json` manifest:
```json
{
  "name": "my-template",
  "displayName": "My Template",
  "description": "What it does in one sentence",
  "tags": ["domain", "use-case"],
  "agents": 3,
  "executor": "mixed"
}
```

3. Add your `agents/`, `pipelines/`, `schemas/`, `prompts/`, `nodes/` directories

4. Add a `README.md` with pipeline flow diagram, quick start, and customisation guide

5. Test it: `agentforge init --template my-template`

### Agent YAML conventions

- `pi-ai` executor: for analysis, planning, writing — no tools needed
- `pi-coding-agent` executor: for code generation, file operations — use `tools: [read, write, edit, bash, grep, find]`
- Use `{{output_schemas}}` placeholder in system prompts — schemas are injected at runtime
- Define `definitions` + `flow` blocks for pi-coding-agent to get loops and scripts

### Loop pattern

```yaml
definitions:
  run-tests:
    type: script
    run: npm test 2>&1
    captureOutput: true
  test-gate:
    type: script
    run: |
      if [ "{{steps.run-tests.exitCode}}" = "0" ]; then echo "PASS"; else echo "false"; fi
  fix-code:
    type: llm
    description: "Fix failures: {{steps.run-tests.output}}"

flow:
  - loop:
      until: "{{steps.test-gate.output}}"
      maxIterations: 3
      do:
        - step: run-tests
        - step: test-gate
        - step: fix-code
```
