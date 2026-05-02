# Confirmation rules

The user must explicitly authorise any command that costs money or
mutates shared state. Read-only commands run immediately.

## What requires confirmation

| Command | Why |
|---|---|
| `run --project ...` | Starts a full pipeline. Sums of all agent budgets are at risk. |
| `run --continue <id>` | Resumes/retries a run. Same cost surface. |
| `exec <agent>` | Runs one agent — still real LLM tokens. |
| `gate approve <id>` | Advances the pipeline; downstream agents will fire (cost). |
| `gate reject <id>` | Marks the pipeline failed — terminal. |
| `gate revise <id>` | Re-runs the phase with revision notes (cost). |
| `apply -f <path>` | Writes definitions to the DB-backed store. |
| `node start ...` | Registers infrastructure with the control plane. |

## What does NOT require confirmation

| Command | Why |
|---|---|
| `list`, `info`, `templates list` | Pure reads of local state. |
| `get pipelines | pipeline | gates | gate | nodes` | Pure reads of state store. |
| `describe node` | Pure read. |
| `logs <run-id>` | Tails the log; does not change state. |
| `dashboard` | Starts a server (long-running but reversible). |
| `init` | Writes new files; subject to the normal "default to creating" rule but not strictly state-mutating in the AgentForge sense. |

## How to phrase the confirmation

Use `AskUserQuestion` (Claude Code) or the host agent's interactive-prompt
tool. Otherwise, write the question in chat and wait.

Required content:

1. **The exact command** you will execute.
2. **The expected effect** in plain English.
3. **The cost ceiling** for `run` / `exec` if visible from agent budgets.
4. **What can be undone**, if anything.

### Examples

**`run`:**

> *About to start a new pipeline run:*
>
> ```
> agentforge-core run --project invoicing-saas \
>   --pipeline simple-sdlc \
>   --input "brief=Build a freelance invoicing SaaS"
> ```
>
> *This will spend up to ~$0.85 (sum of agent `maxCostUsd`: analyst $0.10,
> architect $0.15, developer $0.60). Pauses at gate after architecture.
> The run is cancellable mid-flight via `agentforge-core run --continue
> <run-id>` or the dashboard.*
>
> *Proceed? (y/n)*

**`gate approve`:**

> *About to approve gate `gate-2026-05-02-abc`:*
>
> ```
> agentforge-core gate approve gate-2026-05-02-abc
> ```
>
> *This advances the `simple-sdlc-2026-05-02-xyz` pipeline from phase 2
> (architecture) into phase 3 (implementation). The developer agent will
> fire next, with up to $0.60 of budget. Approval cannot be undone.*
>
> *Proceed? (y/n)*

**`apply` (platform):**

> *About to upsert YAML resources into the DB-backed definition store:*
>
> ```
> agentforge apply -f .agentforge/agents/analyst.agent.yaml
> ```
>
> *This will overwrite the existing `analyst` agent definition in the
> Postgres store. In-flight runs use the previous version; new runs
> will use this one. Reversible by re-applying the prior YAML.*
>
> *Proceed? (y/n)*

## Batching

If the user issues multiple state-changes in one message ("approve all
pending gates"), confirm once **per gate**, not once for the batch. The
audit trail records each as a separate decision.

Exception: identical mechanical commands across many resources may batch
("apply every YAML file in `.agentforge/`"). State the count and ask for
one confirmation; show the file list before executing.

## After execution

Always report:

1. **What ran** (the command, restated).
2. **What it returned** (success / failure, summarised).
3. **What's next** (the most likely follow-up action the user might want).

For irreversible actions (`gate reject`, `gate approve` on a run that
then auto-advances), add a one-line *"this advanced X to phase Y"* so
the user knows the side effect happened.

## When confirmation is interrupted

If the user does not respond, or responds with anything other than a
clear yes:
- **Treat anything ambiguous as a no.** Do not run the command.
- **Surface the original question again** with whatever new context the
  user provided.
- Never auto-execute on timeout.

If the user is impatient and says *"just do it"* or similar after a
question, that counts as confirmation for the **single** command in
question — not a blanket authorisation for future ones.
