# Artifact Typing & Validation

> Part of the [AgentForge documentation](README.md).

Every agent declares typed inputs and outputs. Artifacts are validated against Zod / JSON Schemas at every pipeline boundary — invalid output fails the agent run before it reaches the next phase.

```
Agent YAML                    Zod Schema                      Runtime
┌─────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│ outputs:        │    │ RequirementsSchema   │    │ Agent produces JSON  │
│   - type:       │───▶│   = z.object({       │───▶│ → safeParse(output)  │
│     requirements│    │     epics: [...],    │    │ → pass ✓  or fail ✗  │
│     schema: ... │    │     ...              │    └──────────────────────┘
└─────────────────┘    │   })                 │
                       └──────────────────────┘
```

## What ships

45 built-in schemas covering requirements, architecture, code, data, testing, security, and DevOps — see `packages/core/src/schemas/`. Every shipped template references them so you can compose pipelines without inventing new artifact types.

## Defining your own

Add a Zod schema in TypeScript and reference it from agent YAML by file path:

```yaml
# .agentforge/agents/my-agent.agent.yaml
spec:
  outputs:
    - type: my-artifact
      schema: schemas/my-artifact.schema.yaml
```

The schema file can be either Zod-shaped TypeScript (loaded via the schema registry) or a JSON Schema YAML — both validate at the same boundary.

Architectural details and the artifact flow through phases: [`docs/architecture.md`](architecture.md#artifact-flow).

## Why this matters

- **Malformed LLM output is caught early.** Bad JSON, missing fields, or wrong types abort the agent run before downstream agents consume it.
- **Wiring is explicit.** Each agent's `inputs[].type` and `outputs[].type` form a contract. Two agents producing the same type is a configuration error you catch at `agentforge validate` time, not at runtime.
- **Schemas double as docs.** New team members understand what each phase produces by reading one file.
