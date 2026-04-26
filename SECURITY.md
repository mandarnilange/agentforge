# Security Policy

## Supported versions

AgentForge is in early release. Security fixes land on the latest minor
version only.

| Version | Supported |
|---------|-----------|
| `0.2.x` | ✅ |
| `< 0.2` | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security-sensitive reports.**

Use GitHub's private vulnerability reporting so the maintainers can
triage it before any disclosure:

1. Go to the [Security tab](https://github.com/mandarnilange/agentforge/security)
2. Click **Report a vulnerability**
3. Fill in the advisory form (affected version, reproduction steps,
   impact, suggested fix if any)

You should receive an acknowledgement within **48 hours**. For
actively-exploitable issues we aim for an initial fix or mitigation
within **7 days**; for lower-severity issues within **30 days**. We
will coordinate disclosure with you before any public advisory.

## Scope

In scope:

- Secret leakage via logs, traces, conversation transcripts, error
  messages, or dashboard output
- Credential exposure through the Postgres / SQLite state store
- Unauthenticated or insufficiently-authenticated control plane
  endpoints (node registration, job dispatch, result reporting)
- Container escape or host-level privilege escalation from the
  Docker / remote executors
- Code injection via YAML definitions, pipeline inputs, or the
  dashboard API
- Supply-chain concerns in the npm packages (`@mandarnilange/agentforge-core`,
  `@mandarnilange/agentforge`) or the GHCR container images

Out of scope:

- Rate-limiting bypasses on the dashboard UI
- Denial of service via legitimate-but-expensive LLM calls
- Vulnerabilities in third-party LLM providers (Anthropic, OpenAI,
  Google, Ollama) — please report those to the provider directly
- Security issues in `pi-coding-agent` or `pi-ai` upstream — open
  an issue on their respective repositories

## Known transitive advisories

`npm audit` currently flags `uuid <14.0.0` (GHSA-w5hq-g745-h8pq,
moderate) reached via `dockerode@4.x`. The advisory is specific to
`uuid.v3/v5/v6` when called with a caller-supplied `buf` argument;
`dockerode` only uses `uuid.v4()`, which is **not** affected.
AgentForge has no direct dependency on `uuid` and does not invoke the
vulnerable code path. The fix lands in v0.3 with `dockerode@5.x`
(which drops the `uuid` dependency entirely) once
`@types/dockerode@5` is published.

## Safe harbour

Good-faith security research is welcome. We will not pursue legal
action against researchers who follow this policy, give us reasonable
time to respond, and avoid accessing data belonging to other users.
