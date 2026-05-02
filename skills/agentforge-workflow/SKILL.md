---
name: agentforge-workflow
description: >
  Guides a user through designing an AgentForge workflow — the agents, pipeline,
  gates, loops, parallelism, wiring, and node placement — and emits a complete,
  schema-valid `.agentforge/` directory. Trigger when the user asks to author,
  define, scaffold, design, or modify an AgentForge pipeline / agent / node, or
  says things like "help me set up a workflow", "I want to build an agent
  pipeline", "what agents do I need for X", or "turn this template into ...".
  Do NOT trigger for unrelated AI-agent frameworks (LangGraph, CrewAI, etc.).
license: MIT
metadata:
  author: mandarnilange
  version: "0.2.0"
---

# AgentForge Workflow

You are helping the user define an **AgentForge** workflow. AgentForge is a
Kubernetes-style control plane for AI agents: agents are declarative YAML, run
in phased pipelines, and gate on human approval between phases. This skill
walks the user through the design decisions and produces a working
`.agentforge/` directory.

## When to use this skill

Trigger on any of:
- "Help me define / author / design / scaffold an AgentForge workflow"
- "What agents do I need for <problem>?"
- "Turn this brief into a pipeline"
- "Modify the `<template>` template to ..."
- A user asking about agent definitions, pipeline phases, gates, wiring, or
  node placement *in the context of AgentForge*.

Do **not** trigger for generic LLM-app design or other agent frameworks.

## Reference material

Read these on demand — do not load them upfront:

- `references/agent-schema.md` — AgentDefinition cheat sheet (executors, model,
  inputs/outputs, definitions, flow, loops, parallel)
- `references/pipeline-schema.md` — PipelineDefinition cheat sheet (phases,
  gates, parallel, wiring, retryPolicy, gateDefaults)
- `references/node-schema.md` — NodeDefinition cheat sheet (local / docker /
  ecs, capabilities, nodeAffinity)
- `references/template-catalog.md` — when to start from a shipped template
  versus from scratch, and which template fits which shape of problem
- `references/scaffold.md` — exact `.agentforge/` directory layout to emit

The authoritative Zod schemas live in
`packages/core/src/definitions/parser.ts` — read that file if you are unsure
about a field. Do not invent fields.

## The flow

Work through these stages in order. Skip a stage only if the user has already
answered it or it clearly does not apply (e.g. no parallelism needed → skip
parallel design).

### 1. Goal

Ask, in one or two questions, what the workflow should *produce* given what
*input*. You need:

- **Input** — what the user feeds the pipeline (a brief, a URL, a code repo, a
  dataset, a ticket).
- **Output artifacts** — what files / decisions / code the workflow should
  hand back.
- **Hard constraints** — budget, deadline, must-run-locally, must-be-airgapped,
  human-approval requirements, regulated domain, etc.

Restate what you heard in 2–3 lines before moving on.

### 2. Template-first check

Before designing from scratch, scan `references/template-catalog.md`. If a
shipped template (`simple-sdlc`, `api-builder`, `seo-review`,
`content-generation`, `code-review`, `data-pipeline`) is within ~70% of the
user's goal, recommend starting from it and modifying. Tell the user *which*
template, *why*, and *what they will need to change*.

If no template fits, design from scratch.

### 3. Agent decomposition

For each agent, capture:

| Field | Notes |
|---|---|
| `metadata.name` | kebab-case, unique within the pipeline |
| `metadata.role` | human-equivalent role label |
| `metadata.phase` | which phase number it runs in |
| `spec.executor` | `pi-ai` for thinkers, `pi-coding-agent` for code-modifying agents |
| `spec.model` | provider + model name + `thinking` level (low / medium / high) |
| `spec.inputs` | artifact `type`s it consumes |
| `spec.outputs` | artifact `type`s it produces (and a schema file path) |
| `spec.tools` | only for `pi-coding-agent` — `read`, `write`, `edit`, `bash`, `grep`, `find` |
| `spec.resources.budget` | `maxTotalTokens` and `maxCostUsd` per run |

Rules of thumb:

- One agent = one well-named human role doing one phase of work.
- If an "agent" is really two jobs glued together, split it.
- Every output `type` becomes a contract — downstream agents will declare it
  as an input. Pick names you will not regret (`requirements`, not
  `analyst-output-v2`).
- A `pi-coding-agent` is the only kind that can read/write files. If an agent
  produces structured JSON only, it is `pi-ai`.

### 4. Pipeline shape

Decide:

1. **Phase order** — strict topological order based on which artifacts each
   agent needs.
2. **Gates** — between which phases does a human need to approve before the
   next phase runs? Default: gate after expensive or one-way phases (after
   architecture before implementation, after spec before code-gen). Skip
   gates for cheap reversible steps.
3. **Parallel phases** — a phase with `parallel: true` runs all listed agents
   concurrently. Use this when their inputs are identical or independent
   (e.g. Code Generator + Test Generator both consume the same spec).
4. **Cross-cutting agents** — agents that run *after every phase* (security,
   compliance). Listed under `crossCutting:` on each phase or under
   `spec.crossCuttingAgents` for global ones.
5. **Wiring** — explicit `wiring:` block when an agent needs an artifact from
   a non-immediate predecessor. Implicit wiring (consume the previous phase's
   output) does not need an entry.

### 5. Per-agent flow (only for `pi-coding-agent`)

If any agent has multiple steps (setup → generate → lint → test → fix-loop →
commit), define `spec.definitions` (named step library) and `spec.flow`
(execution order). See `references/agent-schema.md` for the full step
grammar — `script`, `llm`, `validate`, `transform`, plus `parallel` and
`loop` blocks inside `flow`.

For `pi-ai` agents, you almost never need `flow` — a single LLM call
producing the output artifact is the norm.

### 6. Nodes

Pick a node profile per executor type the workflow uses:

- **`local`** — runs on the user's machine, no isolation, fast feedback.
  Default for prototypes.
- **`docker`** — sandboxed; required for `pi-coding-agent` in any shared
  environment.
- **`ecs`** — for cloud-hosted control planes (platform package only).

Use `nodeAffinity.preferred` (or `required`) on each agent to steer
placement. A `pi-coding-agent` doing git commits should require `git` and
`docker` capabilities.

### 7. Schemas

Every output `type` should have a schema file under
`.agentforge/schemas/<type>.schema.yaml`. Reuse the shipped schemas in
`packages/core/src/schemas/` whenever possible (`frd`, `architecture`,
`test-suite`, etc.). For new artifact types, write a minimal Zod-shaped YAML
schema — do not over-specify; the agent fills it in.

### 8. Emit the scaffold

Write the full directory per `references/scaffold.md`. **Default to creating
new files** — see the *Modification policy* below before touching anything
that already exists. After writing:

1. Tell the user the exact CLI command to validate it
   (`npx @mandarnilange/agentforge validate` from the project root).
2. Show the run command for their pipeline
   (`npx @mandarnilange/agentforge run-pipeline <name> --input ...`).
3. Stop. Do not run the pipeline yourself unless the user asks.

## Modification policy

**Default behaviour: create new files. Never overwrite or edit existing
agent / pipeline / node / prompt / schema files unless the user has
explicitly asked you to "update", "edit", "modify", "fix", or "rewrite"
the existing one.**

Before this skill runs, scan `.agentforge/` to see what already exists:

```bash
ls .agentforge/agents .agentforge/pipelines .agentforge/nodes .agentforge/prompts .agentforge/schemas 2>/dev/null
```

Three cases:

1. **Empty `.agentforge/` (greenfield).** Create everything. No
   confirmation needed.

2. **Existing `.agentforge/` and the user said "update", "edit", "modify",
   "extend", "rewrite", or named a specific file to change.** You may
   edit, but **before each edit**, ask explicit confirmation. Use
   `AskUserQuestion` (Claude Code) or the host agent's interactive-prompt
   tool when available. Otherwise, state the proposed change in chat and
   wait for a yes/no:

   > *"`agents/analyst.agent.yaml` already exists with executor `pi-ai`
   > and budget $0.10 / 40k tokens. You asked to swap the model to
   > `claude-haiku-4-5`. Apply this edit? (y/n)"*

   One question per file. Batch only when the changes are mechanically
   identical (e.g. version bump across three agent files).

3. **Existing `.agentforge/` and the user has NOT signalled an edit
   intent.** Default to **adding new files alongside** the existing ones:
   - New agent → `agents/<new-name>.agent.yaml`
   - New pipeline → `pipelines/<new-name>.pipeline.yaml`
   - New schema → `schemas/<new-type>.schema.yaml`

   Pick a name that doesn't collide. If a name collision is unavoidable
   (e.g. user asked for "another analyst" and `analyst.agent.yaml`
   already exists), confirm before reusing the name — propose
   `analyst-v2.agent.yaml` or `analyst-<domain>.agent.yaml` first and
   ask which they prefer.

**Never silently overwrite.** A file that exists is the user's prior
work; treat it as authoritative until they say otherwise.

When unsure whether the user is asking for "extend" vs "edit", ask. The
cost of one clarifying question is much lower than the cost of clobbering
their pipeline.

## Hard rules

- **Do not invent schema fields.** Every YAML key you emit must exist in
  `packages/core/src/definitions/parser.ts`. If unsure, read that file.
- **One artifact `type` = one producer.** Two agents producing the same
  `type` is a bug — rename one.
- **Gates default to required.** When the user says "I want to review before
  the next step", that is a gate, not a comment in the prompt.
- **Budgets are required** on every agent. Do not ship an agent without
  `resources.budget`.
- **System prompts go in files**, not inline `text:`, once a workflow is past
  prototype stage. Use `prompts/<agent>.system.md`.
- **Never modify shipped templates in place.** Copy them into the user's
  `.agentforge/` directory first, then edit.
- **Default to creating new files. Confirm before editing existing ones.**
  See *Modification policy* above. Use `AskUserQuestion` or the host
  agent's interactive-prompt tool. Never silently overwrite.

## What success looks like

After this skill runs, the user has:

- A `.agentforge/` directory with `agents/`, `pipelines/`, `nodes/`,
  `prompts/`, and `schemas/` subdirectories filled in.
- Every YAML file parses against the schema.
- A one-paragraph summary in chat of: agent count, phase count, gates,
  parallel blocks, loops, node placement.
- The exact `agentforge run-pipeline ...` command to execute it.
