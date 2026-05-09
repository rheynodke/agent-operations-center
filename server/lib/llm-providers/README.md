# LLM Providers

Pluggable backends for AOC reflection / generation. Used by `reflection-service.cjs`.

## Current providers

| Name | Status | Notes |
|---|---|---|
| `claude-code` | Implemented (Phase 1) | Spawns `claude` CLI with `-p --output-format json`. Free on Max subscription. |
| `anthropic-api` | Planned | Direct Anthropic SDK call. Pay-per-token. |
| `openai-compatible` | Planned | Generic — covers OpenRouter, LMStudio, Kilocode, Together, Groq, vLLM, Ollama. |

## Interface

A provider exports:

```javascript
{
  name: 'provider-name',
  complete(req: CompleteRequest): Promise<CompleteResponse>,
  supportsModel?(model: string): boolean
}

type CompleteRequest = {
  prompt: string;
  model: string;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
  timeoutMs?: number;
  signal?: AbortSignal;
};

type CompleteResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  providerLatencyMs: number;
};
```

## Adding a new provider

1. Create `<name>-provider.cjs` exporting the interface above.
2. Register in `index.cjs` PROVIDERS map.
3. Add unit tests in `<name>-provider.test.cjs` (use Module._load stub for HTTP/spawn isolation).
4. Document in this README.
5. Add env vars to `.env.example` if config required.

## Configuration

Selection via env:

```
REFLECTION_LLM_PROVIDER=claude-code        # registry key
REFLECTION_LLM_MODEL=claude-haiku-4-5      # provider-specific
REFLECTION_TIMEOUT_MS=60000
```

Future OpenAI-compatible swap (no code change):

```
REFLECTION_LLM_PROVIDER=openai-compatible
REFLECTION_LLM_BASE_URL=https://openrouter.ai/api/v1
REFLECTION_LLM_API_KEY=sk-or-v1-...
REFLECTION_LLM_MODEL=anthropic/claude-haiku-4.5
```
