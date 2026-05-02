# `agentforge-debug` changelog

## 0.2.0 — 2026-05-02

- Strengthened the **confirm-before-mutate** rule into two explicit
  categories: state mutation (gate decisions, run cancel / continue, claim
  clear) and file edits (prompts, schemas, agent / pipeline YAML).
  Previous version only covered state mutation explicitly.
- File edits now require per-file confirmation via `AskUserQuestion` or
  the host agent's interactive-prompt tool. Substantive rewrites default
  to *creating a new file alongside* the existing one; one-line tweaks
  may edit in place after explicit confirmation.
- The fix-path examples in the flow now read "propose, do not edit yet"
  rather than implying immediate edits.
- Added the rule to the *Hard rules* list.
- No trigger-condition changes.

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
