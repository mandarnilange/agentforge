# `@mandarnilange/agentforge` vs `@mandarnilange/agentforge-core`

> Part of the [AgentForge documentation](README.md).

Two npm packages ship from this repo. Most users want **`@mandarnilange/agentforge`** (the platform binary). Pick `@mandarnilange/agentforge-core` only if you're embedding the engine into your own CLI / service or you specifically don't want the platform extras.

## Feature comparison

| | **`@mandarnilange/agentforge-core`** | **`@mandarnilange/agentforge`** (platform) |
|---|---|---|
| **Install** | `npm install @mandarnilange/agentforge-core` | `npm install @mandarnilange/agentforge` (pulls in core) |
| **Binary** | `agentforge-core` | `agentforge` |
| **Intended for** | Local dev, evaluation, library embed | Production, teams, multi-host |
| **LLM providers** | Anthropic | Anthropic + OpenAI + Gemini + Ollama |
| **Executors** | Local (in-process) | Local + **Docker container** + **Remote HTTP** |
| **Node types** | `local` | `local` + `ssh` + remote workers |
| **State store** | SQLite (file) | SQLite **or** PostgreSQL |
| **Persistent definitions** | YAML on disk, loaded per run | YAML on disk **or** `apply` to DB (versioned, hot-reload) |
| **Observability** | OTel API (no-op without SDK) | Full OTel SDK + Jaeger / Grafana export |
| **Crash recovery** | — | Pipeline rehydration + reconciliation loop |
| **Rate limiting** | — | Token / cost / concurrency per pipeline |
| **Multi-host deploy** | — | Control-plane + worker Docker Compose files |
| **Docker image** | `ghcr.io/mandarnilange/agentforge-core` (~289 MB) | `ghcr.io/mandarnilange/agentforge-platform` (~336 MB) |

Defaults are **identical** for local dev (SQLite, local executor, Anthropic). Installing the platform package up front means you won't have to migrate when you need a production feature.

## Using just the framework (`@mandarnilange/agentforge-core`)

If you're embedding the engine into your own CLI or service — or you want the framework without the platform binary, multi-provider middleware, or Postgres — install `@mandarnilange/agentforge-core` directly:

```bash
npm install @mandarnilange/agentforge-core
npx @mandarnilange/agentforge-core init --template simple-sdlc
```

Same YAML schema, same executors, same control plane. You wire your own entry point. Package-level docs: [`packages/core/README.md`](../packages/core/README.md).

## Multi-provider setup

Mixing Anthropic, OpenAI, Gemini, and Ollama (one provider per agent in the same pipeline): [`docs/multi-provider.md`](multi-provider.md).

## Docker images

```bash
docker build --target core     -t agentforge-core     .   # ~289 MB
docker build --target platform -t agentforge-platform .   # ~336 MB
```

Image targets share the same `Dockerfile` — the `platform` target adds the platform-only entry points and env variables.
