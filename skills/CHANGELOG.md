# Skills changelog

Top-level history for every skill under [`skills/`](.). Each skill also
keeps a per-skill `CHANGELOG.md` with finer-grained notes — link to that
file from the entry below.

## Versioning policy

Skills are versioned independently via `metadata.version` in
`SKILL.md`'s frontmatter. Use semver:

| Bump | Trigger |
|---|---|
| **major** | Trigger conditions changed (the skill fires on different prompts now), required tool surface changed, file structure renamed, or an existing reference doc removed. Anything a user has muscle memory for. |
| **minor** | New reference docs, new sections in `SKILL.md`, additive support for new prompts. Existing behaviour preserved. |
| **patch** | Prose tightening, typo fixes, schema cheat-sheet updates that mirror upstream changes, broken-link repairs. |

**Bump on every PR that lands a skill change**, even a tiny one — the
version is what distinguishes one published skill from the next, and
users may pin to it. CI's frontmatter validator enforces presence; the
contributor enforces honesty.

## Release flow

1. Land your change locally and run `npm run skills:validate`.
2. Bump the affected skill's `metadata.version` in its `SKILL.md`.
3. Add an entry to that skill's `CHANGELOG.md` (create the file if it
   does not exist).
4. Add a one-line entry here under the next "Unreleased" or current
   version block, linking to the per-skill changelog.
5. Open a PR. The `Publish Skills` workflow validates frontmatter on
   every push.

There is no separate "publish" command. Once the PR merges into `main`,
`npx skills add mandarnilange/agentforge` picks up the new version on
next install.

## History

### Unreleased

- _add entries here as they merge_

### 2026-05-02

- **`agentforge-template-author` 0.1.0** — initial release. Guides
  contributors through adding a new shipped template under
  `packages/{core,platform}/src/templates/`. See
  [`agentforge-template-author/CHANGELOG.md`](agentforge-template-author/CHANGELOG.md).
- **`agentforge-debug` 0.1.0** — initial release. Triages stuck or
  failing pipeline runs from symptom to fix path. See
  [`agentforge-debug/CHANGELOG.md`](agentforge-debug/CHANGELOG.md).
- **`agentforge-workflow` 0.1.0** — initial release. Walks users through
  designing an AgentForge workflow and emits a complete `.agentforge/`
  directory. See
  [`agentforge-workflow/CHANGELOG.md`](agentforge-workflow/CHANGELOG.md).
