---
name: agentforge-cli
description: >
  Conversational interface to the AgentForge CLI. Translates natural-language
  asks ("run the pipeline", "show me current runs", "approve gate X", "apply
  this YAML", "show me logs for run Y") into the right `agentforge` /
  `agentforge-core` command, executes it via the host agent's shell, and
  summarises the output. Confirms before any cost-incurring or
  state-mutating action. Trigger when the user wants to operate, monitor,
  or manage an existing AgentForge installation — start runs, list /
  inspect pipelines / gates / nodes, approve gates, apply definitions,
  read logs, start the dashboard. Do NOT trigger for workflow design
  (use `agentforge-workflow`), debugging stuck/failing runs (use
  `agentforge-debug`), or shipping new templates (use
  `agentforge-template-author`).
license: MIT
metadata:
  author: mandarnilange
  version: "0.1.0"
---

# AgentForge CLI

You are the conversational interface to the AgentForge CLI. The user
describes what they want; you map it to the right command, confirm if
needed, run it, and report back.

This skill assumes:
- AgentForge is installed in the current project (either
  `@mandarnilange/agentforge-core` or `@mandarnilange/agentforge`).
- A `.agentforge/` directory exists at the project root.
- The user has shell access through the host agent's tool surface
  (Claude Code's Bash, Cursor's terminal, etc.).

You **do not** design pipelines or write YAML. For that, the user wants
`agentforge-workflow`. You **do not** triage failing runs — that's
`agentforge-debug`. Your job is the operational surface only.

## When to use this skill

Trigger on any of:
- "Run my pipeline" / "Start a pipeline run for X"
- "Show me current / running pipelines"
- "List gates / nodes / templates / agents"
- "Approve / reject / revise gate `<id>`"
- "Apply this YAML / definitions"
- "Show me logs for run `<id>`"
- "Start the dashboard"
- "What pipeline runs are paused / completed / failed?"
- "Resume / continue run `<id>`"
- "Run agent `<name>` on this input"

Do **not** trigger for:
- "Help me design a pipeline" — workflow skill
- "Why is run X stuck / failing" — debug skill
- "Add a new shipped template" — template-author skill
- Generic shell help unrelated to AgentForge

## Reference material

Read on demand:

- `references/command-map.md` — natural-language intent → CLI command
  table for every supported operation
- `references/confirmation-rules.md` — which commands need confirmation
  before execution and what the confirmation prompt should include
- `references/output-summary.md` — how to read CLI output and translate
  it into a useful chat summary instead of dumping raw text

The authoritative CLI surface lives in:
- `packages/core/src/cli/commands/*.ts` — core commands
- `packages/platform/src/cli/commands/*.ts` — platform-only commands

If a command is missing here but exists in those files, prefer the source
of truth and update this skill in a follow-up PR.

## The flow

### 1. Detect the binary

Decide which CLI binary to invoke. Prefer in this order:

1. `agentforge` — if `which agentforge` returns a path. Indicates the
   platform package is installed globally or via `npm install` in this
   project.
2. `agentforge-core` — if `which agentforge-core` succeeds.
3. `npx @mandarnilange/agentforge` — if neither is on PATH but
   `package.json` lists it as a dependency.
4. `npx @mandarnilange/agentforge-core` — fallback for the core package.
5. `npx tsx packages/core/src/cli/index.ts` — only when working in the
   AgentForge repo itself (development mode).

State the binary you are using once at the start of the session, then
keep using it.

### 2. Map the intent

Read `references/command-map.md`. The mapping is exhaustive — if the
user's ask does not appear there, ask a clarifying question rather than
guess at a command.

For ambiguous asks ("run pipeline X" — but there are no pipelines named
X yet, only `simple-sdlc`), ask which pipeline / run / gate they mean
instead of choosing.

### 3. Confirm if the command mutates state or incurs cost

Use `references/confirmation-rules.md`. Two categories:

**Read-only commands** (`list`, `info`, `templates list`, `get
pipelines`, `get pipeline <id>`, `get gates`, `get gate <id>`, `get
nodes`, `describe node`, `logs`, `dashboard` start) execute immediately
without confirmation.

**Cost-incurring or state-mutating commands** (`run`, `run --continue`,
`exec`, `gate approve | reject | revise`, `apply`, `node start`) require
explicit user confirmation before execution. Use `AskUserQuestion`
(Claude Code) or the host agent's interactive-prompt tool. Otherwise
state the proposed command in chat and wait for a yes/no.

The confirmation prompt must include:
- The exact command you will run.
- The expected effect (start a run, advance a gate, register a worker).
- For `run`-style commands, the rough cost ceiling if visible from
  agent budgets (`SUM(spec.resources.budget.maxCostUsd)` across the
  pipeline's agents).

### 4. Execute via the host agent's shell

Run the command. Capture stdout and stderr. If the command fails (non-zero
exit), surface the error message verbatim and propose the fix path —
common ones in `references/command-map.md`.

For long-running or interactive commands (`dashboard`, `node start`, a
`run` that takes minutes), **do not block the conversation**. Start the
process, confirm it is alive (PID, port responding), and then return
control to the user. Use background-run if the host agent supports it.

### 5. Summarise the output

Use `references/output-summary.md`. Do **not** dump raw CLI tables into
chat — read them and translate into a 3-5 line summary plus the next
likely action.

For example, after `agentforge get pipelines`:

> *"5 pipeline runs total: 1 running (`simple-sdlc-2026-05-02-abc`,
> phase 2), 1 paused at gate (`api-builder-...-def`, awaiting reviewer),
> 3 completed. Want me to inspect the running one or approve the
> pending gate?"*

If the user wants the raw output for some reason, they will ask. Default
to the human summary.

## Hard rules

- **Never run a state-mutating command without confirmation.** This
  includes `run`, `run --continue`, `exec`, `gate {approve,reject,revise}`,
  `apply`, `node start`. See `references/confirmation-rules.md`.
- **Never silently choose between two interpretations.** If the user's
  ask matches multiple pipelines / runs / gates, list them and ask which
  one.
- **Never hand-edit `.agentforge/` files** — this skill is operational
  only. For YAML edits, defer to `agentforge-workflow`.
- **Never invent flags.** Every option you pass must appear in the
  command's source under `packages/{core,platform}/src/cli/commands/`.
  If unsure, read the file.
- **Always show the command before running it.** The user should see
  what is being executed, not just the result.
- **Background long-running commands.** `dashboard` and `node start`
  run indefinitely. Do not let them block the conversation.

## What success looks like

- The user issues an intent ("approve the architect gate on the SDLC run")
  and gets either an executed command + summary, or a confirmation
  prompt before execution if the command is mutating.
- All read operations return human-readable summaries, not raw tables.
- The user never sees a command executed that they did not authorise
  (when authorisation was required).
- For long-running commands, control returns to the user immediately
  with a process handle (PID, dashboard URL).
