# PipelineDefinition cheat sheet

Authoritative source: `packages/core/src/definitions/parser.ts`
(`PipelineDefinitionSchema`).

## Skeleton

```yaml
apiVersion: agentforge/v1
kind: PipelineDefinition
metadata:
  name: <kebab-case>
  displayName: <Human Name>
  description: <one line>

spec:
  input:
    - name: brief
      type: raw-brief
      description: Project brief or feature description
      required: true

  repository:
    mode: auto-init             # creates a fresh git repo per run

  phases:
    - name: requirements
      phase: 1
      agents: [analyst]

    - name: architecture
      phase: 2
      agents: [architect]
      gate:
        required: true
        approvers:
          minCount: 1
          roles: [admin, reviewer]

    - name: build
      phase: 3
      parallel: true            # all listed agents run concurrently
      agents: [code-gen, test-gen]

    - name: review
      phase: 4
      agents: [reviewer]
      crossCutting: [security]  # runs alongside this phase

  wiring:
    architect:
      requirements: analyst
    developer:
      requirements: analyst
      architecture-plan: architect

  gateDefaults:
    actions: [approve, reject, request-revision]
    timeout: 72h

  retryPolicy:
    maxRetries: 2
    backoff: exponential
    initialDelay: 30s

  limits:
    maxTokens: 500000
    maxCostUsd: 5.00
    maxConcurrentRuns: 3

  crossCuttingAgents:           # globally cross-cutting, runs after every phase
    security: {}
```

## Phases

| Field | Required | Notes |
|---|---|---|
| `name` | yes | human-readable phase name |
| `phase` | yes | integer ordering key |
| `agents` | yes | one or more agent names from `agents/` |
| `parallel` | no | default false; true → all agents run concurrently |
| `gate` | no | human approval before the next phase |
| `crossCutting` | no | agents that run alongside this phase |

## Gates

A gate blocks the next phase until a human approves via the dashboard.

```yaml
gate:
  required: true                # default true if `gate` is present
  waitForAll: true              # wait for all approvers vs first-to-approve
  approvers:
    minCount: 1
    roles: [admin, reviewer]
```

When to gate:
- After expensive irreversible work (architecture, schema design).
- Before code-gen kicks in.
- At any phase the user said they want to "review before continuing".

When **not** to gate:
- Cheap reversible analysis steps.
- Cross-cutting checks (those run automatically alongside).

`gateDefaults` applies to every `gate:` block that does not override.

## Wiring

By default each agent receives the **previous phase**'s outputs as inputs.
`wiring:` is only needed when an agent needs an artifact from a
non-immediate predecessor:

```yaml
wiring:
  developer:
    requirements: analyst       # type: producer
    architecture-plan: architect
```

Read as: "developer's `requirements` input is produced by `analyst`."

## Parallel phases

```yaml
- name: build
  phase: 3
  parallel: true
  agents: [frontend, backend, data]
```

All three agents run at once. Their inputs must already exist (from prior
phases). Their outputs can each be wired into the next phase.

## Cross-cutting agents

Two flavours:

1. **Per-phase** — `crossCutting: [security]` on a phase definition. Runs
   after that phase's main agents complete.
2. **Global** — `spec.crossCuttingAgents: { security: {} }`. Runs after
   every phase.

Both expect a real agent definition file under `agents/`.

## Common mistakes

- Defining a gate but forgetting `approvers.roles` → no one can approve.
- `parallel: true` on a phase whose agents have inter-dependencies.
- `wiring:` referencing an agent that does not produce that `type`.
- Adding a `crossCutting` agent that has no definition file.
