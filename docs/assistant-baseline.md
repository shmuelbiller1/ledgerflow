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

Before: 0 of 18 book questions answered without a model. After: see below. The pinned list of questions that must go to the model (`src/tests/assistant-router-sbx2.test.ts`) still goes to the model. Invoice lookups match the number exactly, an empty or capped search goes to the model, figure questions with a qualifier (excluding, net, per, in <place>…) go to the model, and a balance is read to date including opening balances.

Fixed part of every request (system prompt + 25 tool definitions): 50787 bytes, about 12697 tokens (bytes ÷ 4 estimate).
Replay questions: 30 (18 the books can answer exactly, 12 that need the model).
Answered without a model: 9 of 18 questions the books can answer; questions that need the model answered by code: 0 (must be 0).
No model configured (ASSISTANT_REPLAY_MODEL / ASSISTANT_REPLAY_BASE_URL): model-path tokens, times and cost are not measured.

| path | turns | ok | model calls | median input tokens | median output tokens | median tools offered | median answer ms (no streaming yet) | median total ms | total cost (cents) |
|---|---|---|---|---|---|---|---|---|---|
| code | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0000 |
| model | 21 | not measured | not measured | not measured | not measured | 25 | not measured | not measured | not measured |

## Part 3 — remembered decisions (before / after)

- **Before:** every proposed step started from scratch. A payee the person had already coded to the
  same account many times was proposed with no account, and the model had to work it out again.
- **After:** each accepted or rejected sandbox step updates `assistant."rememberedDecisions"` in the
  same transaction, per workspace, keyed by command + payee/vendor/customer + field (account, cash
  account, tax code, class). A choice is offered only at ≥95% over ≥5 cases, labelled "from your
  earlier choice" with its case count (the assistant read tool `remembered_choices`, `POST /sandboxes/:id/tools/remembered_choices`). It is never applied
  to the step and never auto-accepted. A member lists it (`GET /sandboxes/remembered`) and forgets one or all with the registered command `assistant.forgetremembered`.
  Only ids and codes are stored; no amounts, memos or other book text. The assistant's database role
  has no access.
- **Measured effect:** none yet. It needs real accept history; the turn metric will show it as fewer
  tool calls on steps with a remembered account.
