# Your First AgentForge Run — Skill Quickstart

> 5-minute path from zero to your first agentic pipeline using the
> [`agentforge-workflow`](../skills/agentforge-workflow/SKILL.md) skill.

This file is **editable**. Fill in the bracketed sections, paste them into
your AI coding agent (Claude Code / Cursor / Codex), and the skill takes
over.

---

## 1. One-time setup

```bash
# Install the framework (core is enough for most starter pipelines)
npm install @mandarnilange/agentforge-core

# Install the skills into your AI coding agent
npx skills add mandarnilange/agentforge

# Set your LLM key
export ANTHROPIC_API_KEY=sk-ant-...
```

> Already have `@mandarnilange/agentforge` (the platform binary) installed?
> The skills work the same way; just use `agentforge` instead of
> `agentforge-core` in the commands below.

---

## 2. Drop in the starter `.agentforge/` (optional)

If your project owner shared a default `.agentforge/` directory, copy it
into your project root before continuing.

If not, leave it out — the skill will design one from scratch in step 4.

---

## 3. Fill in your project brief

✏️ **Edit the section between the markers below.** Anything in `<...>` is
a placeholder.

<!-- BEGIN BRIEF -->

**Goal**
> <One sentence: what should this pipeline produce?>

**Inputs**
> <What you feed the pipeline — a brief, a URL, a code repo, a dataset, a ticket>

**Output artifacts**
> <Files / decisions / code the workflow should hand back>

**Hard constraints**
> <Budget, deadline, must-run-locally, regulated domain, must-be-airgapped, etc. Or "none">

**Starting point**
> <One of: "use the .agentforge starter as-is", "extend the .agentforge starter", "design from scratch", or name a shipped template like "start from simple-sdlc">

<!-- END BRIEF -->

---

## 4. Trigger the skill

Open your AI coding agent in this project. Paste:

> Help me set up my AgentForge workflow. Here is my brief — please use the
> `agentforge-workflow` skill.
>
> *(paste the BRIEF section above)*

The skill walks through any clarifying questions, recommends a starting
template if one fits, and emits a complete `.agentforge/` directory.

> **What the skill will and will not do** — by default it *creates new
> files alongside* anything that already exists. It only edits existing
> agents / pipelines / prompts when you explicitly say *update*, *edit*,
> *modify*, *extend*, or *rewrite* (or name a specific file). Per-file
> confirmation before any edit. See the
> [Modification policy](../skills/agentforge-workflow/SKILL.md#modification-policy)
> for the full rules.

---

## 5. Run your first pipeline

```bash
# Validate the .agentforge/ the skill produced
npx @mandarnilange/agentforge-core list

# Run it
npx @mandarnilange/agentforge-core run \
  --project my-first-run \
  --input "brief=<paste your brief here>"

# Watch it live
npx @mandarnilange/agentforge-core dashboard      # → http://localhost:3001
```

---

## 6. Iterate

To evolve the pipeline later, ask the same agent:

- *"Add a new agent for security review after the architect."* → adds a
  new agent file, no existing files touched.
- *"Update the analyst agent to use `claude-haiku-4-5`."* → asks for
  per-file confirmation, then edits.
- *"Add a parallel test-generation phase."* → new pipeline file or
  modification, with confirmation.
- *"My run is stuck at phase 2."* → fires
  [`agentforge-debug`](../skills/agentforge-debug/SKILL.md) to triage.

---

## What success looks like

- A complete `.agentforge/` directory in your project root.
- A green run with artifacts under `output/`.
- A dashboard view at <http://localhost:3001> showing the run timeline.

If anything looks off, ask your agent: *"why is pipeline `<run-id>`
failing?"* — `agentforge-debug` takes it from there.
