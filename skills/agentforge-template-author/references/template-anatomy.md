# Template anatomy

Authoritative source: `packages/core/src/templates/registry.ts` and the
shipped templates under `packages/core/src/templates/simple-sdlc/`.

## Directory layout

```
packages/<core|platform>/src/templates/<name>/
├── template.json                         # required manifest
├── README.md                             # required user-facing doc
├── agents/
│   ├── <agent-1>.agent.yaml
│   └── ...
├── pipelines/
│   └── <name>.pipeline.yaml              # one pipeline file per template
├── nodes/
│   ├── local.node.yaml                   # at least one node profile
│   └── docker.node.yaml                  # if any pi-coding-agent
├── prompts/
│   ├── <agent-1>.system.md
│   └── ...
└── schemas/
    └── <new-output-type>.schema.yaml     # only for output types not in
                                           # packages/core/src/schemas/
```

## `template.json` manifest

The registry validates this object via `isValidManifest`. Required fields:

```json
{
  "name": "<kebab-case>",
  "displayName": "Human Friendly Name",
  "description": "One-line description; shown in `agentforge templates list`.",
  "tags": ["sdlc", "starter"],
  "agents": 3,
  "executor": "pi-ai"
}
```

| Field | Type | Notes |
|---|---|---|
| `name` | string | Must equal the directory name. Lowercase + dashes. |
| `displayName` | string | Title-cased label shown in lists. |
| `description` | string | One sentence. Surfaces in CLI + dashboard. |
| `tags` | string[] | At least one tag. Conventional tags: `starter`, `sdlc`, `code`, `content`, `data`, `ops`, `regulated`. |
| `agents` | number | Total agent count. Used for sorting + display. |
| `executor` | string | `pi-ai`, `pi-coding-agent`, or `mixed`. |

Any extra fields are ignored. Missing or wrong-typed fields cause the
registry to skip the template with a console warning at startup — silent in
production but visible in tests.

## Discovery rules

The core registry (`packages/core/src/templates/registry.ts`):

1. Scans `packages/core/src/templates/*/` at runtime.
2. Reads each subdirectory's `template.json`.
3. Validates via `isValidManifest`.
4. Caches the result for the process lifetime.

The platform registry (`packages/platform/src/templates/registry.ts`)
does the same for `packages/platform/src/templates/*/` and merges with
the core list at runtime. Platform templates take precedence on name
collision — keep template names globally unique to avoid surprises.

There is no central "register this template" call. **Drop the directory
in, ship the manifest, you're listed.** Tests will fail if the manifest
is malformed.

## Pipeline file naming

```
pipelines/<template-name>.pipeline.yaml
```

The pipeline's `metadata.name` should match the template's directory name.
This is what end-users pass to `agentforge run-pipeline <name>` after
running `init --template <name>`.

## Node profiles

Templates ship at least one `local.node.yaml`. Any template with a
`pi-coding-agent` should also ship `docker.node.yaml` so the user can
opt into sandboxed runs without writing their own node file.

Capabilities to declare:

- `local.node.yaml`: `[git, llm-access]`
- `docker.node.yaml`: `[docker, git, llm-access]` (and `local-fs` if the
  agent needs to write files outside the container)

## Prompt file template

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

- <2-4 specific bullets>

## Hard constraints

- <out-of-scope behaviours>
```

Keep prompts under ~150 lines. End-users will read and edit them.

## Schema file template

Reuse from `packages/core/src/schemas/` whenever possible. For genuinely
new artifact types:

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
additionalProperties: false
```
