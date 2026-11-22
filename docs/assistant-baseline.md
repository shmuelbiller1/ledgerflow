# SBX-2 assistant baseline

Run 2026-11-22 with `scripts/assistant-replay.ts` (test data only).

Fixed part of every request (system prompt + 25 tool definitions): 50787 bytes, about 12697 tokens (bytes ÷ 4 estimate).
Replay questions: 30 (18 the books can answer exactly, 12 that need the model).
No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): every question would go to the model today; token, time and cost columns need a model run.

| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median first word ms | median total ms | total cost (cents) |
|---|---|---|---|---|---|---|---|---|---|
| model | 30 | not measured | not measured | not measured | not measured | 25 | not measured | not measured | not measured |
