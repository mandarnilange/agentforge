# NodeDefinition cheat sheet

Authoritative source: `packages/core/src/definitions/parser.ts`
(`NodeDefinitionSchema`, re-exported from the domain layer).

## Skeleton

```yaml
apiVersion: agentforge/v1
kind: NodeDefinition
metadata:
  name: <kebab-case>
  displayName: <Human Name>
  description: <one line>

spec:
  type: local                   # local | docker | ecs
  capabilities:
    - git
    - llm-access
    - docker
  resources:
    maxConcurrentRuns: 2
```

## Node types

| Type | Use when | Notes |
|---|---|---|
| `local` | dev / prototyping on the user's machine | no isolation, fastest iteration |
| `docker` | sandboxed coding agents, multi-tenant | required for `pi-coding-agent` in shared environments |
| `ecs` | platform deployment on AWS | platform package only |

## Capabilities

Free-form labels. Conventions:

- `git` — node has git installed and credentials available
- `llm-access` — node can reach the configured LLM provider
- `docker` — node can spawn Docker containers (matters for sandboxed flows)
- `internet` — node has unrestricted outbound network
- Add custom labels for domain-specific needs (e.g. `gpu`, `terraform`, `aws-creds`)

## Pairing nodes with agents

Agents request placement via `nodeAffinity` in their definition:

```yaml
# in an agent file
nodeAffinity:
  required:
    - capability: docker        # agent will not run if no node has this
  preferred:
    - capability: git           # scheduler prefers, but will fall back
```

Rule of thumb:
- A `pi-coding-agent` doing git commits → `required: [git]`, `preferred:
  [docker]`.
- A `pi-ai` agent doing pure analysis → no affinity needed; any
  `llm-access` node will do.

## Common mistakes

- Defining nodes the agents do not target — wasted config.
- An agent requiring a capability no node provides — the run will block.
- Mixing `local` and `docker` capabilities on a single node — pick one
  isolation level per node.
