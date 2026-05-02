# Skill Quickstart

5 minutes, four steps, zero YAML. You talk; the skill writes the
pipeline.

---

## 1. Install the skill

```bash
npm install @mandarnilange/agentforge-core
npx skills add mandarnilange/agentforge
export ANTHROPIC_API_KEY=sk-ant-...
```

That installs three skills into your AI coding agent:

| Skill | What it does |
|---|---|
| `agentforge-workflow` | Designs your pipeline and writes `.agentforge/` |
| `agentforge-template-author` | (For contributors) ships a new template upstream |
| `agentforge-debug` | Triages a stuck or failing run |

---

## 2. Open your AI coding agent

Any of these works the same way — **Claude Code, Cursor, Codex, Aider,
Continue.dev**. Open the agent in your project folder. The skills
auto-load; no restart needed.

---

## 3. Tell the skill what you want

Type a one- or two-sentence description of what you're trying to build.
The `agentforge-workflow` skill catches the trigger and asks any
follow-ups it needs (inputs, outputs, gates, budgets, parallelism).

Try one of these as a starting prompt:

**Classic SDLC pipeline**
> Help me design an AgentForge pipeline that turns a product brief into
> requirements, an architecture plan, and working code. I want a human
> approval gate after the architecture phase.

**Content generation with self-review**
> Build me an AgentForge workflow for producing research-backed blog
> posts: research the topic, write an outline, draft the post, and
> self-review for quality before handing me the final version.

**Code review pipeline**
> I want an AgentForge pipeline that reviews a PR diff and produces
> severity-tagged review comments plus a security risk score. The
> reviewers should run in parallel.

**Something brand new**
> Design an AgentForge workflow for triaging incoming customer-support
> tickets — classify by category, draft a response, route urgent ones
> to a human gate.

What the skill does next:

- Recommends a shipped template if one fits (`simple-sdlc`,
  `content-generation`, `code-review`, `data-pipeline`,
  `seo-review`, `api-builder`).
- Asks any clarifying questions about your inputs, outputs, gates,
  budgets, parallelism.
- Writes a complete `.agentforge/` directory into your project root.

---

## 4. Run the pipeline the skill built

When the skill finishes it tells you the exact commands. They look like:

```bash
# Validate what got generated
npx @mandarnilange/agentforge-core list

# Run it (replace the brief with your real input)
npx @mandarnilange/agentforge-core run \
  --project my-first-run \
  --input "brief=Build a freelance invoicing SaaS"

# Watch the run live
npx @mandarnilange/agentforge-core dashboard      # → http://localhost:3001
```

That's the full loop.

---

## What else you can do, conversationally

The skills are designed to keep working with you across sessions. Some
prompts that keep paying off:

- **Add a new agent** — *"Add a security review agent after the
  architect."* → creates a new agent file; existing ones untouched.
- **Tweak an existing agent** — *"Update the analyst agent to use
  `claude-haiku-4-5`."* → asks you to confirm per file before editing.
- **Add parallelism** — *"Run the test generator and the code generator
  in parallel."* → modifies the pipeline (with confirmation).
- **Insert a gate** — *"I want to review before code generation
  starts."* → adds a gate to the relevant phase.
- **Debug a run** — *"Why is pipeline `<run-id>` stuck at phase 2?"* →
  fires `agentforge-debug` to triage.
- **Ship a new template upstream** — *"Help me contribute a new template
  for ML pipeline scaffolding."* → fires `agentforge-template-author`.

---

## Heads up

By default the workflow skill **creates new files alongside existing
ones** — it never silently overwrites your `.agentforge/`. To edit
something that already exists, say *update / edit / modify / extend* (or
name the file). The skill confirms each edit before writing. Full rules:
[Modification policy](../skills/agentforge-workflow/SKILL.md#modification-policy).
