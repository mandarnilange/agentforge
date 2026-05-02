# Who Uses AgentForge

> Part of the [AgentForge documentation](README.md).

AgentForge is a YAML-and-CLI framework. Engineers and platform teams author it; the *artifacts and gates* it produces are consumed across an organisation.

## Roles, concretely

### Platform / DevOps engineers
**Stand it up once, the rest of the org inherits the substrate.**

- Run AgentForge as a control plane + worker pool for the company.
- Configure node pools, secrets, cost ceilings, OTel export.
- Add new pipelines as `git push` — no per-team glue code to maintain.
- Pair with [`docs/platform-architecture.md`](platform-architecture.md).

### Software engineers
**Build the agents your domain needs; reuse the harness.**

- Author `.agent.yaml`, `.pipeline.yaml`, and step pipelines.
- Wire your linter, tests, and security scanners as `script` steps so they gate the LLM. See the harness model: [`docs/harness-model.md`](harness-model.md).
- Ship AI-assisted features without giving up code-review discipline — every step lands in the OTel trace and the dashboard timeline.

### Product / domain owners (marketing, sales, HR, ops, legal, finance)
**Don't write YAML. Drive runs from the dashboard.**

- Kick off pipelines via the dashboard or CLI ("run `seo-review` on this URL").
- Approve / reject / revise at human gates between phases — plain-English revision notes, no code.
- Read and download the typed artifacts the pipeline produces.

The artifact-typing model means revision notes steer the next LLM call: gates are a two-way conversation, not a rubber stamp. Every decision is signed, timestamped, and survives restarts.

## What everyone gets

One binary, one control plane, one audit trail:

- **Cost guardrails at every layer.** Each agent declares its own token + dollar ceiling; pipelines carry org-wide limits. The dashboard shows spend in real time. Runaway LLM calls abort cleanly *before* they bill you.
- **Typed artifacts.** 45 built-in Zod / JSON Schemas for SDLC outputs (and you define your own). Malformed LLM output fails the run before it poisons the next phase. See [`docs/artifacts.md`](artifacts.md).
- **Humans in the loop.** Plain-English approvals between phases — the LLM proposes; the human decides.
- **Real-time dashboard.** Pipeline timeline, live agent conversation, artifact viewer, PDF export, cost tracking — same binary, no extra install.
- **Open source, MIT.** No paid tier, no cloud dependency, no telemetry.
