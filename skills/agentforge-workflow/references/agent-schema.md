# AgentDefinition cheat sheet

Authoritative source: `packages/core/src/definitions/parser.ts`
(`AgentDefinitionSchema`).

## Skeleton

```yaml
apiVersion: agentforge/v1
kind: AgentDefinition
metadata:
  name: <kebab-case>            # required, unique
  displayName: <Human Name>     # optional
  description: <one line>       # optional
  phase: "1"                    # required, string
  role: <role-key>              # optional
  humanEquivalent: <Job Title>  # optional

spec:
  executor: pi-ai               # or pi-coding-agent
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384
    thinking: medium            # low | medium | high
  systemPrompt:
    file: prompts/<name>.system.md   # XOR with text
    # text: |
    #   inline prompt
  tools:                        # only for pi-coding-agent
    - read
    - write
    - edit
    - bash
    - grep
    - find
  inputs:
    - type: <artifact-type>
      required: true
  outputs:
    - type: <artifact-type>
      schema: schemas/<type>.schema.yaml
  resources:
    budget:
      maxTotalTokens: 40000
      maxCostUsd: 0.10
    timeoutSeconds: 600         # 0 disables; default from env
  nodeAffinity:
    preferred:
      - capability: docker
      - capability: git
```

## Executors

| Executor | Use when | Can it touch files? |
|---|---|---|
| `pi-ai` | producing structured artifacts (JSON / docs) | no |
| `pi-coding-agent` | generating, editing, or running code | yes — needs `tools` |

## Steps, definitions, and flow (multi-step agents)

Only multi-step agents need this. Single-shot LLM agents leave `flow`
unset and emit one output.

### `spec.definitions` — named step library

```yaml
spec:
  definitions:
    setup-workspace:
      type: script              # script | llm | validate | transform
      run: |
        cd {{run.workdir}}
        mkdir -p src tests
      description: ...
      continueOnError: true

    generate-code:
      type: llm
      instructions: |
        Generate the implementation from {{inputs.architecture-plan}}.

    run-tests:
      type: script
      run: |
        cd {{run.workdir}} && npm test
      captureOutput: true
      continueOnError: true

    test-gate:
      type: script
      run: |
        if [ "{{steps.run-tests.exitCode}}" = "0" ]; then echo PASS; else echo false; fi

    validate-output:
      type: validate
      schema: code-output
      input: code-output
```

### `spec.flow` — execution order

Three flow item shapes:

```yaml
spec:
  flow:
    - step: setup-workspace                    # plain step
    - step: fix-code
      condition: "{{steps.needs-fix.output}}"  # conditional step

    - parallel:                                # parallel block
        - step: lint
        - step: typecheck

    - loop:                                    # loop block
        until: "{{steps.test-gate.output}}"    # exits when this evaluates truthy
        maxIterations: 3
        do:
          - step: run-tests
          - step: test-gate
          - step: fix-code
```

Rules:
- Every `step:` ref must exist in `spec.definitions`.
- `until` exits the loop when the expression evaluates truthy
  (`PASS`, `true`, non-empty); falsy values (`false`, empty) keep iterating.
- `maxIterations` is a hard cap regardless of `until`.

## Template variables

Available inside `run`, `instructions`, `condition`, `until`:

- `{{run.workdir}}` — the agent's working directory
- `{{run.id}}`, `{{pipeline.id}}` — IDs for logging / commit messages
- `{{inputs.<type>}}` — artifact content from a declared input
- `{{steps.<name>.output}}` / `.exitCode` — last result of a step
- `{{loop.iteration}}` / `{{loop.maxIterations}}` — inside a loop block

## Common mistakes

- Putting `tools:` on a `pi-ai` agent (silently ignored, but misleading).
- Same `output.type` produced by two agents (downstream wiring is ambiguous).
- Forgetting `resources.budget` — review will reject this.
- `systemPrompt` with both `file` and `text` (parser rejects).
- `flow` referencing a step name not in `definitions` (parser rejects).
