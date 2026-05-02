# AgentForge Skills

Agent skills for AgentForge, published via the
[Vercel skills ecosystem](https://skills.sh).

## Installation

Install all skills from this repo into your agent runtime:

```bash
npx skills add mandarnilange/agentforge
```

The Vercel skills CLI scans the repo's `skills/` directory and installs every skill it finds. Want a single skill instead? Use the full GitHub tree URL:

```bash
npx skills add https://github.com/mandarnilange/agentforge/tree/main/skills/agentforge-workflow
```

## New here? Use the quickstart

The [Skill Quickstart](../docs/skill-quickstart.md) is a 5-minute,
fill-in-the-blanks markdown you edit, paste into your AI agent, and run.
It's the recommended path for anyone trying the skills for the first time.

## Available skills

| Skill | Audience | What it does |
|---|---|---|
| [`agentforge-workflow`](./agentforge-workflow/SKILL.md) | End user | Walks through designing an AgentForge workflow — agents, pipeline, gates, loops, parallelism, wiring, nodes — and emits a complete `.agentforge/` directory. |
| [`agentforge-cli`](./agentforge-cli/SKILL.md) | Operator | Conversational interface to the AgentForge CLI. *"Run my pipeline"*, *"approve gate X"*, *"show me logs"* → maps to commands, confirms cost / state changes, summarises output. |
| [`agentforge-debug`](./agentforge-debug/SKILL.md) | Operator | Triages a stuck or failing pipeline run from symptom → state inspection → root-cause classification → fix path. |
| [`agentforge-template-author`](./agentforge-template-author/SKILL.md) | Contributor | Guides adding a new shipped template under `packages/{core,platform}/src/templates/`. Scope check → package selection → manifest → tests → PR checklist. |

Versions, release notes, and the bump policy live in [`CHANGELOG.md`](./CHANGELOG.md).

## Layout

```
skills/
└── <skill-name>/
    ├── SKILL.md           <- entry point with YAML frontmatter
    └── references/        <- on-demand reading (cheat sheets, examples)
```

Skill folder names and `name:` frontmatter must match and **must start
with `agentforge-`**. `npm run skills:validate` enforces both.

## Frontmatter

```yaml
---
name: agentforge-<skill-name>
description: >
  Both *what* the skill does and *when* to trigger it.
license: MIT
metadata:
  author: <github-handle-or-org>
  version: "0.1.0"
---
```

Required: `name`, `description`, `license`, `metadata.author`,
`metadata.version`.

## Authoring a new skill

1. `mkdir -p skills/agentforge-<name>/references`
2. Write `SKILL.md` with the frontmatter above and clear *trigger
   conditions* in the description.
3. Add reference docs under `references/` for anything the skill should
   load on demand. Keep `SKILL.md` short — it loads on every trigger.
4. `npm run skills:validate`
5. Open a PR. CI runs the same validator on every push.

## Publishing

There is no upload step. Once a skill lands on the default branch under
`skills/<name>/`, Vercel's CLI discovers it on install. It will appear on
[skills.sh](https://skills.sh) automatically once it accrues install
telemetry.

## CI

`.github/workflows/publish-skills.yml` validates frontmatter on every PR
and push to `main`.
