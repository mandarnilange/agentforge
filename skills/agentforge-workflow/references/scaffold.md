# `.agentforge/` directory layout

When emitting a workflow, write exactly this layout into the project root:

```
.agentforge/
├── agents/
│   ├── <agent-1>.agent.yaml
│   ├── <agent-2>.agent.yaml
│   └── ...
├── pipelines/
│   └── <pipeline-name>.pipeline.yaml
├── nodes/
│   ├── local.node.yaml
│   └── docker.node.yaml          # if any pi-coding-agent
├── prompts/
│   ├── <agent-1>.system.md
│   ├── <agent-2>.system.md
│   └── ...
└── schemas/
    ├── <output-type-1>.schema.yaml
    └── <output-type-2>.schema.yaml
```

## File naming

- Agent: `agents/<metadata.name>.agent.yaml`
- Pipeline: `pipelines/<metadata.name>.pipeline.yaml`
- Node: `nodes/<metadata.name>.node.yaml`
- Prompt: referenced by the agent's `spec.systemPrompt.file` — usually
  `prompts/<agent-name>.system.md`
- Schema: referenced by the agent's `spec.outputs[].schema` — usually
  `schemas/<output-type>.schema.yaml`

## Prompt file template

Keep system prompts in their own `.md` files so they are easy to review
and version separately from agent config:

```markdown
# <Agent Display Name> — System Prompt

You are <role>. Your job is to <one-sentence mission>.

## Inputs

You will receive:
- `<input-type>`: <what it contains>

## Output contract

Produce a single artifact of type `<output-type>` matching the schema at
`schemas/<output-type>.schema.yaml`. Do not invent fields outside the schema.

## Quality bar

- <2-4 specific bullets the agent must satisfy>

## Hard constraints

- <e.g. "no code generation in this phase", "stay within the user's stated budget">
```

## Schema file template

Schemas are YAML files describing the artifact shape. Use the shipped
schemas in `packages/core/src/schemas/` as references when possible. For
new types:

```yaml
$schema: https://json-schema.org/draft/2020-12/schema
title: <ArtifactName>
description: <one line>
type: object
required: [<field-1>, <field-2>]
properties:
  <field-1>:
    type: string
    description: <what this is>
  <field-2>:
    type: array
    items:
      type: object
      required: [name]
      properties:
        name: { type: string }
        description: { type: string }
additionalProperties: false
```

## After emitting

Tell the user:

1. The file tree you wrote (one line per file is enough).
2. The validate command:
   ```bash
   npx @mandarnilange/agentforge validate
   ```
3. The run command, with the inputs you defined:
   ```bash
   npx @mandarnilange/agentforge run-pipeline <pipeline-name> \
     --input <name>="<value>"
   ```
4. Where to fill in the prompt files (point to each one — they are the
   most likely thing the user will want to refine).

Do **not** run the pipeline. Do **not** install the package. Stop here
unless the user explicitly asks for the next step.
