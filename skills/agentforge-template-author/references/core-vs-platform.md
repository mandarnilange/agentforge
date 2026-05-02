# Core vs platform — picking the right package

A template lives in **one** package. Cross-package imports are forbidden.
Pick wrong and CI rejects the PR.

## Decision matrix

| Need | Core | Platform |
|---|---|---|
| Anthropic only | ✓ | ✓ |
| OpenAI / Gemini / Ollama | — | ✓ |
| `pi-ai` executor | ✓ | ✓ |
| `pi-coding-agent` executor | ✓ | ✓ |
| Local node | ✓ | ✓ |
| Docker executor | — | ✓ |
| SSH / remote workers | — | ✓ |
| SQLite state store | ✓ | ✓ |
| Postgres state store | — | ✓ |
| OTel API only (no SDK) | ✓ | ✓ |
| Full OTel SDK + Jaeger / Grafana | — | ✓ |
| Crash recovery + reconciliation | — | ✓ |
| Per-pipeline rate limiting | — | ✓ |

If every cell on the row is `core`, ship to **core**. Even one platform-only
need pushes the template to **platform**.

## Why this matters

- Core is the smallest install (`@mandarnilange/agentforge-core`). Every
  template in core is usable without the platform binary.
- Platform adds runtime extras but is heavier. Templates here are only
  reachable via `@mandarnilange/agentforge`.
- A platform-only feature in a core template breaks the core build (CI will
  fail on the cross-package import).

## Quick smell test

Read your draft `template.json` + agent files and ask:

1. Do any agents have `model.provider: openai | google | ollama`? → platform
2. Do any nodes use `type: docker | ssh`? → platform
3. Does a script step rely on Postgres? → platform
4. Does any agent require multi-host scheduling? → platform

If you said no to all four, you have a **core** template. Most starter
templates land in core.

## Cross-package patterns to avoid

- ❌ `import { ... } from "@mandarnilange/agentforge-core/..."` inside a
  platform template's tests.
- ❌ A core template's agent referencing a platform-only schema.
- ❌ A core template's pipeline using a `crossCutting` agent that lives in
  platform.
- ❌ Conditional logic in the registry to "promote" a core template into
  platform under certain conditions.

If you find yourself reaching for any of these, ship the template to
platform instead — it is allowed to import from core, the reverse is not.
