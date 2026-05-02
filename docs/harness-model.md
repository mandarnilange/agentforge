# The Harness Model

> Part of the [AgentForge documentation](README.md).

Most agent frameworks treat an "agent" as one LLM call wrapped in a few tools. AgentForge treats an agent as a **harness** — a named flow of steps where the LLM is just one step type. Your existing tools (linters, test runners, security scanners, custom CLIs) sit alongside the LLM and *gate its output* on every run.

The result: bad LLM output never leaks to the next phase, and you customise behaviour by editing YAML — not by forking the framework.

---

## Step types

Each agent declares a flow of named steps from this set:

| Type | What it does |
|---|---|
| `llm` | Invokes the agent's model with the system prompt + inputs. The normal LLM call. |
| `script` | Runs a shell command on the node. Has access to template variables (`{{run.workdir}}`, `{{pipeline.id}}`, `{{steps.<name>.output}}`, `{{steps.<name>.exitCode}}`). |
| `validate` | Runs a Zod / JSON Schema check against a named artifact or the last LLM output. Fails the run by default; set `continueOnError: true` to log and continue. |
| `transform` | Pure data reshape between steps (no side effects). |

Plus two control-flow constructs usable anywhere in a flow:

- **`loop`** — retry a block until a predicate step outputs a success sentinel, with a `maxIterations` ceiling.
- **`condition`** — skip a step when a referenced step's output doesn't match.

---

## Real example — the bundled `developer` agent

This is from `packages/core/src/templates/simple-sdlc/agents/developer.agent.yaml`. It shows the *generate → lint → test → fix-until-passing* pattern that `script` + `loop` unlock together:

```yaml
spec:
  executor: pi-coding-agent
  tools: [read, write, edit, bash, grep, find]

  definitions:
    generate-code:
      type: llm
      instructions: |
        Generate the full implementation based on the requirements and architecture plan.

    lint-and-format:
      type: script
      run: |
        cd {{run.workdir}}
        # Auto-detect + run the project's linter/formatter
        if   [ -f package.json  ]; then npx eslint src/ --fix; npx prettier --write "src/**/*.{ts,js}"
        elif [ -f pyproject.toml ]; then python -m black .; python -m ruff check --fix .
        elif [ -f go.mod        ]; then gofmt -w .
        fi
      continueOnError: true

    run-tests:
      type: script
      run: |
        cd {{run.workdir}}
        if   [ -f package.json  ]; then npm test
        elif [ -f pyproject.toml ]; then python -m pytest -v
        elif [ -f go.mod        ]; then go test ./...
        fi
      captureOutput: true
      continueOnError: true

    test-gate:
      type: script
      run: |
        if [ "{{steps.run-tests.exitCode}}" = "0" ]; then echo "PASS"; else echo "false"; fi

    fix-code:
      type: llm
      instructions: |
        Fix attempt {{loop.iteration}} of {{loop.maxIterations}}.
        Failing tests:
        {{steps.run-tests.output}}
        Fix the source code — don't modify tests unless they have a genuine bug.

    validate-output:
      type: validate
      schema: code-output

    git-commit:
      type: script
      run: |
        cd {{run.workdir}}
        git add -A && git commit -m "feat(developer): pipeline {{pipeline.id}}"
      continueOnError: true

  flow:
    - step: generate-code
    - step: lint-and-format
    - loop:
        until: "{{steps.test-gate.output}}"     # exits when test-gate emits "PASS"
        maxIterations: 3
        do:
          - step: run-tests
          - step: test-gate
          - step: fix-code
            condition: "{{steps.test-gate.output}}"   # skip fix if tests passed
    - step: validate-output
    - step: git-commit
```

---

## Why this matters

- **Your existing tools stay in charge of correctness.** The LLM proposes; `eslint`, `pytest`, `go vet`, `trivy`, `semgrep`, whatever you already trust, decide whether the output is acceptable. Bad LLM output doesn't leak into the next phase.
- **Customise without forking.** Want a different linter, a stricter security scan, a different commit convention? It's YAML — edit the `run:` block. No framework recompile.
- **Domain-agnostic.** The same mechanics build a content agent (generate → SEO audit → Grammarly → publish), a data agent (generate SQL → explain-plan → dry-run → apply), an ops agent (generate runbook → shellcheck → render to PDF). Scripts are the universal glue.
- **Observable.** Every step — LLM and script — lands in the state store with output, exit code, duration, and a span in your OTel trace. The dashboard timeline shows the whole harness, not just the LLM turn.

---

## Template variables

Every `script.run`, `llm.instructions`, `condition`, and `loop.until` field is a template. Available bindings:

- `{{run.workdir}}` — agent's working directory on the node
- `{{run.id}}`, `{{pipeline.id}}` — IDs for logging / commits
- `{{inputs.<type>}}` — content of a declared input artifact
- `{{steps.<name>.output}}` / `.exitCode` — last result of a named step
- `{{loop.iteration}}` / `{{loop.maxIterations}}` — current loop position

Full grammar and resolution semantics: [`docs/architecture.md`](architecture.md).

---

## Step grammar reference

For the authoritative shape of `step`, `loop`, `parallel`, and `condition` blocks, see the Zod schema in `packages/core/src/definitions/parser.ts` (`AgentDefinitionSchema`). Pipeline execution and artifact flow: [`docs/pipeline-execution-flows.md`](pipeline-execution-flows.md).
