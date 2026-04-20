# simple-sdlc Template

A lightweight 3-agent software development pipeline. Use this as a starting point for any project that needs requirements analysis, architecture design, and code generation.

## Pipeline Flow

```
[Brief] → Analyst → requirements → Architect → [Gate] → architecture-plan → Developer → code-output
                                                  ↑
                                          Human approval required
```

## Agents

| Agent | Executor | Input | Output | Key Feature |
|-------|----------|-------|--------|-------------|
| `analyst` | pi-ai | raw-brief | requirements | Epics, stories, acceptance criteria |
| `architect` | pi-ai | requirements | architecture-plan | Components, tech stack, ADRs |
| `developer` | pi-coding-agent | requirements + architecture-plan | code-output | Generate → lint → test → fix loop |

## Quick Start

```bash
# Scaffold this template
agentforge init --template simple-sdlc

# List agents and pipeline
agentforge list

# Run the pipeline with your project brief
agentforge run-pipeline simple-sdlc --input brief="Build a REST API for a task manager with user auth"
```

## Customisation

### Change the tech stack
Edit `prompts/architect.system.md` — add your preferred defaults in the **Select the tech stack** section.

### Add more agents
1. Create a new `agents/<name>.agent.yaml` following the existing pattern
2. Add a new phase in `pipelines/simple-sdlc.pipeline.yaml`
3. Wire the new agent's inputs in the `wiring:` section

### Adjust test-fix loop iterations
In `agents/developer.agent.yaml`, find the `flow:` section and change `maxIterations`:

```yaml
- loop:
    until: "{{steps.test-gate.output}}"
    maxIterations: 5   # increase for complex projects
```

### Use Docker nodes (requires agentforge)
Apply the Docker node definition:

```bash
agentforge apply nodes/docker.node.yaml
```

Then add `nodeAffinity` to the developer agent requiring the `docker` capability.

## Inputs

| Field | Required | Description |
|-------|----------|-------------|
| `brief` | Yes | Project description — can be a few sentences or a full RFP |

## Outputs

| Artifact | Produced by | Description |
|----------|-------------|-------------|
| `requirements` | analyst | Structured epics, stories, acceptance criteria |
| `architecture-plan` | architect | Components, tech stack, API design, ADRs |
| `code-output` | developer | Generated code summary with test results |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `AGENTFORGE_OUTPUT_DIR` | No | Where to write artifacts (default: `./output`) |

## Extending to Production

Once you've validated the pipeline, consider adding:
- A QA agent after the developer phase to generate and run test suites
- A DevOps agent as the final phase to produce CI/CD config and deployment runbooks
- A cross-cutting security agent that runs after each gate

Swap in the platform templates (`api-builder`, `code-review`, `data-pipeline`, etc.) for richer pipelines — each adds its own agents and gates on top of the same mechanics shown here.
