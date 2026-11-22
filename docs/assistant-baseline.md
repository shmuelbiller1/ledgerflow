# SBX-2 assistant baseline

## Part 1 — before (no router; every question went to the model)

Run 2026-11-22 with `scripts/assistant-replay.ts` (test data only).

Fixed part of every request (system prompt + 25 tool definitions): 50787 bytes, about 12697 tokens (bytes ÷ 4 estimate).
Replay questions: 30 (18 the books can answer exactly, 12 that need the model).
No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): every question would go to the model today; token, time and cost columns need a model run.

| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median answer ms (no streaming yet) | median total ms | total cost (cents) |
|---|---|---|---|---|---|---|---|---|---|
| model | 30 | not measured | not measured | not measured | not measured | 25 | not measured | not measured | not measured |

## Part 2 — after the router (run 2026-11-22, test data only)

Before: 0 of 18 book questions answered without a model. After: see below. The pinned list of questions that must go to the model (`src/tests/assistant-router-sbx2.test.ts`) still goes to the model. Invoice lookups match the number exactly, and an empty or capped search goes to the model.

Fixed part of every request (system prompt + 25 tool definitions): 50787 bytes, about 12697 tokens (bytes ÷ 4 estimate).
Replay questions: 30 (18 the books can answer exactly, 12 that need the model).
Answered without a model: 9 of 18 questions the books can answer; questions that need the model answered by code: 0 (must be 0).
No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): model-path tokens, times and cost are not measured.

| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median answer ms (no streaming yet) | median total ms | total cost (cents) |
|---|---|---|---|---|---|---|---|---|---|
| code | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0000 |
| model | 21 | not measured | not measured | not measured | not measured | 25 | not measured | not measured | not measured |
