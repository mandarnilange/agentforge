# `agentforge-workflow` changelog

## 0.1.0 — 2026-05-02

Initial release.

- Walks the user from goal → template-first check → agent decomposition
  → pipeline shape → per-agent flow → nodes → schemas → scaffold emit.
- On-demand reference cheat sheets for AgentDefinition, PipelineDefinition,
  NodeDefinition schemas plus a template catalog and the `.agentforge/`
  scaffold layout.
- Hard rules: no invented schema fields, one producer per artifact type,
  budgets required, prompts in files, gates default to required.
