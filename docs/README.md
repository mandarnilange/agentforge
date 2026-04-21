# AgentForge Documentation

> Start here: [root README](../README.md) for the project overview and quick start.

Deep-dive guides, grouped by audience.

## Getting started

- **[Getting Started](getting-started.md)** — full walkthrough from install to running a pipeline, using the dashboard, and working with approval gates.
- **[Testing Guide](testing-guide.md)** — dry-runs without an API key, real pipeline runs, troubleshooting.

## Understanding the system

- **[Architecture](architecture.md)** — domain model, ports & adapters, artifact flow, how the control plane drives the execution plane.
- **[Pipeline Execution Flows](pipeline-execution-flows.md)** — sequence diagrams for pipeline start, agent execution, gate actions, artifact chaining, and resume.

## Scaling beyond a laptop

- **[Platform Architecture](platform-architecture.md)** — distributed scheduling, recovery, reconciliation, rate limiting, worker nodes.
- **[Multi-Provider Execution](multi-provider.md)** — routing agents to Anthropic, OpenAI, Gemini, or Ollama; executor vs provider.

## Extending AgentForge

- **[Templates](templates.md)** — catalog of bundled pipeline templates (`simple-sdlc`, `api-builder`, `code-review`, `content-generation`, `data-pipeline`, `seo-review`) with use-case guidance.
- **[pi-coding-agent Extensions](pi-coding-agent-extensions.md)** — adding custom tools and lifecycle hooks to coding agents.

## Contributing

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) at the repo root for development setup, commit conventions, and the PR workflow.
