# `agentforge-cli` changelog

## 0.1.0 — 2026-05-02

Initial release.

- Conversational interface to the AgentForge CLI: maps natural-language
  asks ("run my pipeline", "approve gate X", "show me logs", "apply
  this YAML") to the right `agentforge` / `agentforge-core` command,
  executes via the host agent's shell, and summarises the output.
- Read-first / confirm-before-mutate discipline: read-only commands
  (`list`, `info`, `templates list`, `get *`, `describe node`, `logs`,
  `dashboard` start) execute immediately; cost-incurring or
  state-mutating commands (`run`, `run --continue`, `exec`, `gate
  {approve,reject,revise}`, `apply`, `node start`) require explicit
  confirmation via `AskUserQuestion` or equivalent, with cost ceiling
  surfaced when visible from agent budgets.
- Reference docs cover the natural-language → command map (sourced from
  `packages/{core,platform}/src/cli/commands/`), confirmation rules
  with example prompts, and output-summary patterns (3–5 line summaries,
  no raw table dumps unless explicitly asked).
- Hard rules: never run state-mutating commands without confirmation;
  never silently disambiguate between matching resources; never invent
  flags; always show the command before running it; background long-
  running commands like `dashboard` and `node start`.
