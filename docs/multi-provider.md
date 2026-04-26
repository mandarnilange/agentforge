# Multi-Provider Execution

> Part of the [AgentForge documentation](README.md).

AgentForge supports multiple LLM providers via the `@mandarnilange/agentforge` package. Core (`@mandarnilange/agentforge-core`) stays Anthropic-only; platform adds provider-aware middleware for OpenAI, Google Gemini, and Ollama.

## Key Concept: Executor vs Provider

These are **orthogonal**:

- **`spec.executor`** — selects the backend type: `pi-ai` (LLM only) or `pi-coding-agent` (LLM + file tools)
- **`spec.model.provider`** — selects the LLM provider: `anthropic`, `openai`, `google`, `ollama`

You can combine any executor with any provider.

## Architecture

Platform wraps core backends with `ProviderAwareBackend` middleware that validates API keys and handles provider-specific concerns at runtime — based on `request.model.provider`, not the executor type.

```
Agent YAML → spec.executor → Core Backend (pi-ai / pi-coding-agent)
                                   ↓
                          ProviderAwareBackend (validates API key, maps provider)
                                   ↓
                              pi-ai library → LLM API
```

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ProviderAwareBackend` | `platform/src/adapters/execution/provider-aware-backend.ts` | Validates API keys, maps providers (e.g., ollama → openai), strips billing for local models |
| `createPlatformBackendForExecutor` | `platform/src/di/platform-container.ts` | Wraps core backends with provider-aware middleware |
| `platformEstimateCostUsd` | `platform/src/utils/platform-cost-calculator.ts` | Cost calculator with OpenAI/Gemini prices |
| `BackendRegistry` | `platform/src/adapters/execution/backend-registry.ts` | Extensible registry for custom backend factories |

## Agent YAML Configuration

The `executor` stays `pi-ai` or `pi-coding-agent`. Change `model.provider` to switch LLM:

### Anthropic (core, default)

```yaml
spec:
  executor: pi-ai              # or: pi-coding-agent
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514
    maxTokens: 16384
```

### OpenAI

```yaml
spec:
  executor: pi-ai              # or: pi-coding-agent
  model:
    provider: openai
    name: gpt-4o
    maxTokens: 16384
```

### Google Gemini

```yaml
spec:
  executor: pi-ai              # or: pi-coding-agent
  model:
    provider: google
    name: gemini-2.5-pro
    maxTokens: 16384
```

### Ollama (local models)

```yaml
spec:
  executor: pi-ai              # or: pi-coding-agent
  model:
    provider: ollama
    name: llama3
    maxTokens: 4096
```

## Executor Types (unchanged from core)

| Executor | Use Case |
|----------|----------|
| `pi-ai` | Pure LLM — no file tools. Analysis, planning, document generation. |
| `pi-coding-agent` | LLM + tools (read, write, edit, bash, grep, find). Code generation, testing, DevOps. |

Both work with any `model.provider`.

## Model Providers

| Provider | `model.provider` | Env Var Required | Notes |
|----------|-----------------|------------------|-------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | Default, works in core and platform |
| OpenAI | `openai` | `OPENAI_API_KEY` | GPT-4o, o1, o1-mini |
| Google Gemini | `google` | `GOOGLE_API_KEY` | Gemini 2.5 Pro/Flash |
| Ollama | `ollama` | None (optional `OLLAMA_BASE_URL`) | Local models, free. Mapped to OpenAI-compatible API internally. |

## Mixed Providers in a Pipeline

Different agents in the same pipeline can use different providers. Each agent's YAML independently specifies its `model.provider`:

```yaml
# Agent: analyst (requirements on Anthropic)
spec:
  executor: pi-ai
  model:
    provider: anthropic
    name: claude-sonnet-4-20250514

# Agent: architect (architecture on Gemini)
spec:
  executor: pi-ai
  model:
    provider: google
    name: gemini-2.5-pro

# Agent: frontend-dev (code on OpenAI)
spec:
  executor: pi-coding-agent
  model:
    provider: openai
    name: gpt-4o
```

## Cost Calculation

The `platformEstimateCostUsd` function prices tokens for all supported providers:

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|----------------------|
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| o1 | $15.00 | $60.00 |
| gemini-2.5-pro | $1.25 | $10.00 |
| gemini-2.5-flash | $0.15 | $0.60 |
| Ollama (any) | $0.00 | $0.00 |

Claude model prices are handled by the core calculator.

## Adding a New Provider

1. Add provider config to `PROVIDER_CONFIGS` in `provider-aware-backend.ts`:
   ```typescript
   myProvider: {
     envVar: "MY_PROVIDER_API_KEY",
     envVarLabel: "MY_PROVIDER_API_KEY",
   }
   ```
2. Add model prices to `PLATFORM_PRICE_TABLE` in `platform-cost-calculator.ts`
3. Write tests following the existing pattern in `provider-aware-backend.test.ts`
