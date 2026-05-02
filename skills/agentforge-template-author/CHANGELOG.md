# `agentforge-template-author` changelog

## 0.2.0 — 2026-05-02

- Added a **Modification policy** section. Default behaviour is *create
  a new template directory*. Editing a shipped template, the registry,
  an existing test, or `docs/templates.md` requires explicit user intent
  ("update", "edit", "modify") and per-file confirmation via
  `AskUserQuestion` or the host agent's interactive-prompt tool. Editing
  a shipped template is flagged as a **breaking change** because end
  users `agentforge init --template <name>` against it.
- When the user's request overlaps with an existing template but they
  haven't asked to edit it, the skill now defaults to forking
  (`<name>-secure`, `<name>-v2`) instead of in-place modification.
- Added the rule to the *Hard rules* list.
- No trigger-condition changes.

## 0.1.0 — 2026-05-02

Initial release.

- Guides contributors adding a new shipped AgentForge template under
  `packages/{core,platform}/src/templates/<name>/`.
- Walks scope check → package selection → domain & inputs → agent set
  → pipeline shape → prompts → schemas → manifest, README, and tests
  → wire-up → emit.
- Reference docs: template anatomy (directory layout + `template.json`
  manifest contract), core-vs-platform decision matrix, test-and-publish
  PR checklist.
- Hard rules: no invented registry fields, one package only, no
  platform-only features in core templates, every output type has a
  schema, parse tests required.
