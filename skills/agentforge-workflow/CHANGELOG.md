# `agentforge-workflow` changelog

## 0.2.0 — 2026-05-02

- Added a **Modification policy** section. Default behaviour is now
  *create new files*; the skill must scan `.agentforge/` first and only
  edit existing agent / pipeline / node / prompt / schema files when the
  user explicitly says "update", "edit", "modify", "extend", or "rewrite"
  (or names a specific file). Edits require per-file confirmation via
  `AskUserQuestion` or the host agent's interactive-prompt tool.
- Added the rule to the *Hard rules* list as well so it surfaces alongside
  schema and budget constraints.
- No trigger-condition changes; existing prompts still fire the skill.

## 0.1.0 — 2026-05-02

Initial release.

- Walks the user from goal → template-first check → agent decomposition
  → pipeline shape → per-agent flow → nodes → schemas → scaffold emit.
- On-demand reference cheat sheets for AgentDefinition, PipelineDefinition,
  NodeDefinition schemas plus a template catalog and the `.agentforge/`
  scaffold layout.
- Hard rules: no invented schema fields, one producer per artifact type,
  budgets required, prompts in files, gates default to required.
