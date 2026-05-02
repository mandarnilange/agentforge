# Template catalog

Six templates ship with AgentForge. Always check this list before designing
from scratch — modifying a template is faster and less error-prone than
authoring from zero.

| Template | Package | Shape | Best fit |
|---|---|---|---|
| `simple-sdlc` | core | 3 agents, 1 gate, test-fix loop | small briefs → working code, no platform deps |
| `api-builder` | platform | 4 agents, 2 gates, parallel codegen + tests | "build an API from a spec" workflows |
| `seo-review` | platform | 4 agents, 1 gate, sequential | site audits |
| `content-generation` | platform | 5 agents, 2 gates, self-review loop | research-backed long-form content |
| `code-review` | platform | 4 agents, parallel reviewers | PR / branch-diff review pipelines |
| `data-pipeline` | platform | 5 agents, 3 loops | ETL design + IaC + monitoring |

## Decision rules

Pick **`simple-sdlc`** when:
- The workflow is "brief → requirements → architecture → code".
- The user has not asked for parallelism or research phases.
- They want something runnable with zero platform setup.

Pick **`api-builder`** when:
- The output is server code + tests + docs.
- Code generation and test generation can run in parallel (same spec input).
- The user has installed the platform package.

Pick **`seo-review`** or **`content-generation`** when:
- The workflow is research-driven and produces text artifacts, not code.
- Multiple human approval points are expected.

Pick **`code-review`** when:
- Input is an existing repo / diff, not a brief.
- Reviewers can work in parallel on different concerns
  (security / style / correctness).

Pick **`data-pipeline`** when:
- The output is a data system: schema, ETL, IaC, monitoring.
- Loops dominate (schema discovery → ETL → validate → fix).

## Modifying a template

Always copy first, then edit:

```bash
npx @mandarnilange/agentforge init --template <name>
```

This writes `.agentforge/` into the user's project. From there, edit
freely — the shipped template files in `packages/*/src/templates/<name>/`
are read-only references.

Common modifications:
- Swap the model (`spec.model.name`) on one or more agents.
- Insert a new agent in a phase (add to `pipelines/<name>.pipeline.yaml`
  under `agents:` and create the corresponding `agents/<new>.agent.yaml`).
- Remove a gate by deleting the `gate:` block from a phase.
- Change `parallel: true` ↔ false depending on the user's compute budget.
- Add a cross-cutting agent (security, compliance) to relevant phases.

## When no template fits

Design from scratch using the agent-schema, pipeline-schema, and
node-schema references. Use `simple-sdlc` as the structural template — it
is the smallest valid pipeline shape.
