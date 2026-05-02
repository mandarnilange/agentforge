# Translating CLI output to chat

The CLI prints tables. Users want decisions. Translate.

## Default rule

After every command, write **3–5 sentences max** that:
1. Confirm the command ran (success / failure).
2. Summarise the relevant state change or result.
3. Point at the most likely next action.

Do **not** paste the raw table unless the user explicitly asks for it.
Long output dumps lose information faster than they convey it.

## Per-command summary patterns

### `get pipelines`

Read the table. Group by status and report counts:

> *"5 pipeline runs total: 1 running, 1 paused at gate, 3 completed.
> Most recent run: `simple-sdlc-2026-05-02-abc` (running, phase 2). Want
> me to inspect it or list pending gates?"*

### `get pipeline <id>`

Surface: status, current phase, agent count, last activity, any pending
gate. Skip raw timestamps unless the user asks.

> *"Run `<id>` is paused at gate after phase 2 (architecture). 3 agents
> have run: analyst (succeeded), architect (succeeded). 1 gate pending
> approval (`gate-...`). Cost so far: $0.18 / $0.85 budgeted. Want to
> approve, reject, or request revision?"*

### `get gates`

Filter for `pending` first. Tell the user which need action.

> *"2 gates pending: phase 2 on `simple-sdlc-...-abc`, phase 1 on
> `api-builder-...-def`. 4 already approved. Which one do you want to
> review?"*

### `get nodes` (platform)

Group by status. Surface online count + total capacity.

> *"3 nodes online (worker-gpu, worker-light-1, worker-light-2),
> 1 offline (worker-old). Total capacity: 18 concurrent runs. Want me
> to describe a specific node?"*

### `logs <run-id>`

The output can be long. Either:
- If the user wants a quick pulse: report the last few lines verbatim
  (with line breaks preserved) plus a summary of the run state.
- If the user said "show me logs" without further qualifier: surface the
  most recent ~10 lines and offer to filter with `--conversation` or by
  agent.

### `run` (after a successful start)

> *"Started run `<run-id>` for project `<proj>`. Pipeline:
> `<pipeline-name>`. Phase 1 (`analyst`) is dispatching now. Watch live
> at <http://localhost:3001/runs/<run-id>>, or ask me to pull status."*

### `gate approve | reject | revise`

> *"Approved. The pipeline advanced to phase 3. Developer agent is
> dispatching. Cost ceiling for this phase: $0.60. Watch it on the
> dashboard or ask me for the status in a few minutes."*

### `apply -f`

Report file count + names that updated, and any that failed validation.

> *"Applied 3 YAML files: 1 agent, 1 pipeline, 1 schema. All passed
> validation. The agent definition is now live in the store; in-flight
> runs use the previous version. New runs will use this one."*

### Failures

Always show the error message verbatim. Then propose the fix path from
`command-map.md`. Never paper over the failure.

> *"Run failed to start: `ANTHROPIC_API_KEY` not set in environment.
> Fix: `export ANTHROPIC_API_KEY=sk-ant-...` then retry the same command.
> Want me to retry once the key is set?"*

## When the user wants the raw table

If they say *"give me the actual output"* / *"show the table"* /
*"raw"*, paste the captured stdout in a fenced block. Keep the human
summary above the block; the user can scroll.

## When output is empty

A command that returns nothing (e.g. `get pipelines` on a fresh install)
should be reported as such, not as "command succeeded with no
information":

> *"No pipeline runs yet. Want me to start one with `<bin> run
> --project ...`? I can read your `.agentforge/pipelines/` directory
> for the available pipeline names if you want."*

## Stay action-oriented

Every response ends with what the user could do next, even if it is
just *"Want me to dig deeper into anything?"*. Operational chat is a
loop, not a one-shot.
