# seo-review Template

4-agent SEO audit pipeline that analyses technical signals, keyword positioning, content quality, and produces a prioritised action plan.

## Pipeline Flow

```
[Brief] → Crawler Analyst → Keyword Analyst → Content Auditor → [Gate] → SEO Strategist → action-plan
```

## Agents

| Agent | Executor | Input | Output |
|-------|----------|-------|--------|
| `crawler-analyst` | pi-ai | raw-brief | technical-seo-audit |
| `keyword-analyst` | pi-ai | brief + audit | keyword-analysis |
| `content-auditor` | pi-ai | brief + audit + keywords | content-audit |
| `seo-strategist` | pi-ai | all reports | seo-action-plan |

## Quick Start

```bash
agentforge init --template seo-review
agentforge run-pipeline seo-review \
  --input brief="Audit example.com — a B2B SaaS site. Target keywords: project management software, team collaboration tool. Competitors: Asana, Monday.com. Main concern: organic traffic dropped 20% last quarter."
```

## Input

The `brief` should include: site URL(s), target audience, primary keywords, competitors, and any specific concerns. Include page titles, meta descriptions, and content excerpts if available.

## Outputs

| Artifact | Description |
|----------|-------------|
| `technical-seo-audit` | On-page signals, crawlability, structured data issues |
| `keyword-analysis` | Keyword gaps, cannibalisation, intent mapping |
| `content-audit` | E-E-A-T scores, thin content, readability |
| `seo-action-plan` | Quick wins, strategic initiatives, content roadmap |
