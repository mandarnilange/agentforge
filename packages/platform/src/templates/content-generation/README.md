# content-generation Template

5-agent content factory that takes a topic brief and produces a publish-ready, SEO-optimised article with research backing, human review gates, and a self-revision loop.

## Pipeline Flow

```
[Brief] → Researcher → Outline Writer → [Gate] → Writer (draft→revise loop) → Editor → [Gate] → SEO Optimizer → published-content
```

## Agents

| Agent | Executor | Input | Output | Key Feature |
|-------|----------|-------|--------|-------------|
| `researcher` | pi-ai | raw-brief | research-notes | Facts, angles, audience insights |
| `outline-writer` | pi-ai | brief + research | content-outline | Sections, word targets, evidence mapping |
| `writer` | pi-coding-agent | brief + research + outline | article-draft | Write → self-review → revise loop (2x) |
| `editor` | pi-ai | draft + brief | edited-content | Clarity, flow, accuracy, tone |
| `seo-optimizer` | pi-ai | edited + brief | published-content | Meta tags, keyword placement, schema markup |

## Quick Start

```bash
agentforge init --template content-generation
agentforge run-pipeline content-generation \
  --input brief="Topic: 5 ways to reduce cloud costs. Audience: CTOs at Series A startups. Tone: authoritative but practical. Target: 1500 words. Primary keyword: cloud cost optimisation."
```

## Gates

- **After outline**: human approves the structure before any writing starts
- **After editing**: human approves the final article before SEO pass

## Customisation

**Change word count** — add it to the brief input, or edit the writer prompt's default.

**Add a plagiarism check** — add a `checker` agent (pi-coding-agent with bash tool running a plagiarism CLI) between writer and editor.
