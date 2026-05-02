# `agentforge-template-author` changelog

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
