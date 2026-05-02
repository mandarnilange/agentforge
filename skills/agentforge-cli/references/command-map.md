# Natural language → CLI command map

Every command below is sourced from
`packages/{core,platform}/src/cli/commands/`. If a flag is not in this
table, it does not exist — do not invent one.

Substitute `<bin>` with whichever binary the host has detected
(`agentforge`, `agentforge-core`, `npx @mandarnilange/agentforge`,
`npx @mandarnilange/agentforge-core`).

## Discovery (read-only)

| User says | Command |
|---|---|
| "What agents are available?" | `<bin> list` |
| "Tell me about the analyst agent" | `<bin> info analyst` |
| "What templates ship with AgentForge?" | `<bin> templates list` |
| "Show me current / running pipelines" | `<bin> get pipelines` |
| "Inspect run `<id>`" / "What's the status of `<id>`?" | `<bin> get pipeline <id>` |
| "List gates" / "Any pending gates?" | `<bin> get gates` |
| "List gates for run `<id>`" | `<bin> get gates --pipeline <id>` |
| "Show me gate `<id>`" | `<bin> get gate <id>` |
| "Show me logs for run `<id>`" | `<bin> logs <run-id>` |
| "Show the LLM conversation for run `<id>`" | `<bin> logs <run-id> --conversation` |
| "List nodes" *(platform)* | `<bin> get nodes` |
| "Describe node `<name>`" *(platform)* | `<bin> describe node <name>` |

## Pipeline lifecycle (cost-incurring or state-mutating)

| User says | Command | Confirm? |
|---|---|---|
| "Scaffold a new project" | `<bin> init` | no |
| "Scaffold from template `<name>`" | `<bin> init --template <name>` | no |
| "Run agent `<name>` on this input" | `<bin> exec <name> -i "<text>"` | yes — costs LLM tokens |
| "Start a pipeline run" / "Run my pipeline" | `<bin> run --project <name> --input "<key>=<value>"` (repeat `--input`) | yes — full pipeline cost |
| "Run pipeline `<name>` for project `<proj>`" | `<bin> run --project <proj> --pipeline <name> --input ...` | yes |
| "Resume / continue run `<id>`" | `<bin> run --continue <id>` | yes — resumes cost |

For `exec` and `run`, default `--input` to `-i "<inline-text>"` only when
the input is short. For longer inputs, save to a file and pass `-i <path>`.

When the user says "run my pipeline" without specifying inputs, ask:
- Which `--project` name to use (default to the current directory name).
- What value to pass for each declared `pipeline.spec.input[]` entry.
- Read `.agentforge/pipelines/*.pipeline.yaml` to get the input names if
  unsure.

## Gates (state-mutating)

| User says | Command | Confirm? |
|---|---|---|
| "Approve gate `<id>`" | `<bin> gate approve <id> [--reviewer <name>] [--comment <text>]` | yes |
| "Reject gate `<id>` because <reason>" | `<bin> gate reject <id> --comment "<reason>" [--reviewer <name>]` | yes |
| "Request revision on gate `<id>`: <notes>" | `<bin> gate revise <id> --notes "<notes>" [--reviewer <name>]` | yes |

Always include `--reviewer` if the user named a reviewer. If they did not,
default to omitting it (the audit log records the CLI invocation).

## Dashboard and workers

| User says | Command | Confirm? |
|---|---|---|
| "Start the dashboard" | `<bin> dashboard --port 3001` | no — but background it |
| "Start the dashboard on port `<n>`" | `<bin> dashboard --port <n>` | no |
| "Apply this YAML / definitions" *(platform)* | `<bin> apply -f <path>` | yes — modifies DB-backed definitions |
| "Start a worker node" *(platform)* | `<bin> node start --control-plane-url <url> --name <n> --capabilities <list>` | yes — registers infrastructure |

For `dashboard` and `node start`, background the process. After it starts
running, poll once to confirm it is alive (e.g. `curl -sf
http://127.0.0.1:3001/health` for the dashboard) and report the PID + URL
to the user, then return control.

## Disambiguation patterns

When the user says "approve the gate" without an ID:

1. Run `<bin> get gates` (read-only, no confirmation).
2. Filter for `pending` gates.
3. If exactly one, propose approving it; confirm before running.
4. If multiple, list them with run-id + phase, ask which.

When the user says "show me logs" without an ID:

1. Run `<bin> get pipelines` to list runs.
2. If one matches "the latest" or "the running one", use it.
3. Otherwise, ask which.

When the user says "run the pipeline" but multiple pipelines exist:

1. Read `.agentforge/pipelines/*.pipeline.yaml` filenames.
2. List them and ask which.

## Common command failures and fixes

- **"command not found"** — the binary is not on PATH. Re-detect per the
  flow's step 1; fall back to `npx @mandarnilange/agentforge-core`.
- **"No `.agentforge/` directory"** — the user is in the wrong folder or
  has not scaffolded yet. Suggest `<bin> init` (or fire `agentforge-workflow`
  to design from scratch).
- **"`<run-id>` not found"** — typo or stale ID. Run `<bin> get
  pipelines` and show the user the available IDs.
- **"Gate `<id>` is not pending"** — already decided. Show its current
  status from `<bin> get gate <id>`.
- **"`ANTHROPIC_API_KEY` missing"** for `run` / `exec`. Tell the user to
  `export ANTHROPIC_API_KEY=...`. Do not run a substitute command.
