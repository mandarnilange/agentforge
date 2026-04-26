# Contributing to AgentForge

Thanks for your interest in contributing to AgentForge.

## Development Setup

```bash
git clone https://github.com/mandarnilange/agentforge.git
cd agentforge
npm install
```

## Project Structure

This is a monorepo with two packages:

- `packages/core` — Core SDLC automation (9 agents, pipeline engine, dashboard)
- `packages/platform` — Enterprise extensions (distributed execution, PostgreSQL, OTel)

## Running Tests

```bash
# All tests
npx vitest run

# Watch mode
npx vitest

# Single package
npx vitest run --config packages/core/vitest.config.ts
npx vitest run --config packages/platform/vitest.config.ts
```

## Build

```bash
npx tsc --build
```

## Lint

```bash
npx biome check --write .
```

## Making Changes

1. Create a branch from `main`
2. Write failing tests first (TDD)
3. Implement the change
4. Ensure all tests pass: `npx vitest run`
5. Ensure TypeScript compiles: `npx tsc --build --noEmit`
6. Ensure lint passes: `npx biome check .`
7. Submit a pull request

## Architecture Rules

- **Domain layer** (`packages/core/src/domain/`) has zero external dependencies
- **Core** must never import from **platform** — dependency flows one way only
- Platform imports core types via `@mandarnilange/agentforge-core/...` package imports
- All external concerns are injected through port interfaces

## Commit Messages

Use conventional commits:

```
feat: add new agent capability
fix: handle gate timeout correctly
chore: update dependencies
docs: improve quickstart guide
```
