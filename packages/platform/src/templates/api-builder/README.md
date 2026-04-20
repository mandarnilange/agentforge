# api-builder Template

4-agent pipeline that takes an API brief and produces a working server implementation, test suite, and documentation — with parallel code+test generation and automated fix loops.

## Pipeline Flow

```
[Brief] → Spec Writer → [Gate] → Code Generator ─┐
                                                   ├─ (parallel) → Doc Writer → api-docs
                                 Test Generator ──┘
```

## Agents

| Agent | Executor | Input | Output | Key Feature |
|-------|----------|-------|--------|-------------|
| `spec-writer` | pi-ai | raw-brief | api-spec | Endpoint design, auth scheme, error conventions |
| `code-generator` | pi-coding-agent | api-spec | api-code | Generate → install → lint → test-fix loop (3x) |
| `test-generator` | pi-coding-agent | api-spec | test-suite | Contract + integration + validation tests, fix loop (3x) |
| `doc-writer` | pi-ai | api-spec + api-code | api-docs | Reference, guides, Postman collection |

## Quick Start

```bash
agentforge init --template api-builder
agentforge run-pipeline api-builder \
  --input brief="Build a REST API for a task manager. Users can create, assign, and complete tasks. JWT auth required."
```

## Input

| Field | Required | Description |
|-------|----------|-------------|
| `brief` | Yes | API description — endpoints, resources, auth, business rules |

## Customisation

**Change framework** — edit `prompts/code-generator.system.md`, update the default stack section.

**Add more test categories** — edit `prompts/test-generator.system.md`, add to the test categories list.

**Skip the gate** — set `gate.required: false` in `pipelines/api-builder.pipeline.yaml`.

**Use Docker nodes** — apply `nodes/docker.node.yaml` and add `nodeAffinity.required` to agent YAMLs.
