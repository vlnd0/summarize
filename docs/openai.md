# OpenAI models

Use OpenAI directly by choosing an `openai/...` model id.

For the full model/provider matrix, see `docs/llm.md`.

## Env

- `OPENAI_API_KEY` (required for `openai/...` models)
- `OPENAI_USE_CHAT_COMPLETIONS` (optional; force chat completions)

## Flags

- `--model openai/<model>`
- `--length short|medium|long|xl|xxl|<chars>`
  - This is *soft guidance* to the model (no hard truncation).
- `--max-output-tokens <count>`
  - Hard cap for output tokens (optional).
- `--json` (includes prompt + summary in one JSON object)
