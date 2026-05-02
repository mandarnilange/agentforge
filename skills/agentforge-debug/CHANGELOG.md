# `agentforge-debug` changelog

## 0.1.0 — 2026-05-02

Initial release.

- Triages a stuck or failing AgentForge pipeline run: symptom →
  state inspection → root-cause classification → fix path.
- Read-first discipline: never propose state-mutating actions until run
  state has been read from the state store / dashboard.
- Reference docs: symptom tree (symptom → cause → first command),
  state model (every status enum and transition), fix paths (concrete
  recipes per root cause).
- Hard rules: no SQLite-file deletes, no gate bypass without
  authorisation, no validation skip flags, one fix at a time.
