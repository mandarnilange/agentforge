# code-review Template

4-agent automated code review pipeline. Quality and security reviewers run in parallel — both use tools to read the actual code — then a report writer consolidates findings.

## Pipeline Flow

```
[Brief] → Scope Analyst → Quality Reviewer ─┐
                                              ├─ (parallel) → Report Writer → review-report
                          Security Scanner ──┘
```

## Agents

| Agent | Executor | Input | Output | Key Feature |
|-------|----------|-------|--------|-------------|
| `scope-analyst` | pi-ai | brief | review-scope | Risk classification, focus areas |
| `quality-reviewer` | pi-coding-agent | brief + scope | quality-findings | Static analysis + deep quality check |
| `security-scanner` | pi-coding-agent | brief + scope | security-findings | OWASP Top 10 + dependency scan + secret detection |
| `report-writer` | pi-ai | scope + quality + security | review-report | Consolidated, prioritised report |

## Quick Start

```bash
agentforge init --template code-review
# Run from the repository root — the pipeline uses the current working directory
agentforge run-pipeline code-review \
  --input brief="Review PR #42: adds JWT authentication to the Express API. Changed files: src/middleware/auth.ts, src/routes/users.ts, tests/auth.test.ts. Stack: Node.js + TypeScript."

# Or point explicitly at a repo checkout
agentforge run-pipeline code-review --workdir /path/to/repo \
  --input brief="..."
```

## Input

The `brief` should include: what the change does, which files changed, the tech stack, and any specific areas to focus on. Run `agentforge run-pipeline` from the repository root, or pass `--workdir <path>` to point at a different checkout.

## Verdict Scale

| Verdict | Meaning |
|---------|---------|
| `approve` | No issues found |
| `approve-with-minor-changes` | Nitpicks only — merge after addressing |
| `requires-changes` | Major findings — fix before merge |
| `reject` | Critical security or correctness issues |
