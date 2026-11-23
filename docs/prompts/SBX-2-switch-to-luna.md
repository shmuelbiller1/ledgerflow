# SBX-2: make GPT-6 Luna the live assistant model, with GPT-6.1 Terra as the backup

Prompt for the agent that does this (owner's approval: 23 Nov 2026, "yes set it up and make it ready in the site").
Read `CLAUDE.md` and `CURRENT_WORK.md` first. Code goes on a branch with a PR into `main`. Merge only when CI is
green and every bot comment has been dealt with. Never paste or commit an API key.

## Why

The model test (`scripts/assistant-model-eval.ts`, results in `docs/assistant-model-eval.md`, full turns in
`docs/eval/runs/`) was run on 23 Nov 04:28 with the final tool-free step from PR #1021. Results:

| model | correct (of 12) | billed |
|---|---|---|
| `gpt-6-luna` | 11, and 12 after a grader fix (PR #1021) | 2.0¢ |
| `gpt-6.1-terra` | 12 | 15.3¢ |

Both models read the 4 receipts equally well (15/16 fields). Luna is about 7× cheaper for the same score.

## The catch: the live assistant is not set up like the test

The test sends every question to one model. The live assistant does three things the test does not:

1. **It splits questions between two tiers** (`chooseModel` in `src/server/services/assistantModels.ts`). A question
   matching `VAGUE`, `ANALYSIS` (why / should / afford / summarise / compare), two or more `ACTIONS`, `CHAIN`, or
   over 300 characters goes to the **strong** model. The same happens when the closest command has `risk: 'high'`.
   About half the test questions would go to Terra live, so the live cost per question will be well above 2¢.
2. **It retries once on the strong model** when the simple model fails before drafting a step (reason
   `simple-model-failed`).
3. **It answers some questions with no model at all** (the router in `src/server/services/assistantRouter.ts`).
   It also uses the real read tools on real books, through the read cache.

So the test score can differ from what people get. **Step 1 below makes the test run the same way as the site,
before anything is switched.**

## Steps

### 1. Make the test run the live routing (PR 1)

- In `scripts/assistant-model-eval.ts`, add a routed mode: `ASSISTANT_EVAL_ROUTED=simple,strong`, for example
  `gpt-6-luna,gpt-6.1-terra`.
  - Each question is first passed to `routeQuestion`. A `code` answer is graded as-is and costs 0.
  - Otherwise `chooseModel(question, reason, commands, { simple, strong, ocr })` picks the model.
  - If the simple model's turn fails before drafting, the same question is retried once on the strong model. Use the
    same condition as `answerTurn` in `assistantRouter.ts`: reuse its code and do not copy the rule.
  - The table row is labelled `routed (luna → terra)`. Its columns: correct, the share of questions answered by each
    tier, billed cost, cost per correct answer.
  - Each turn in `docs/eval/runs/*.json` records `tier` and `reason`.
- Tests in `src/tests/assistant-model-eval.test.ts`, with a fake model client:
  - a vague question goes to the strong model;
  - a simple question goes to the simple model;
  - a failed simple turn is retried on the strong model;
  - a code-routed question makes no model call.
- `npx tsx scripts/assistant-model-eval.ts --self-test` must still pass.

### 2. Prices for the two models (same PR)

- `src/lib/ai/modelPricing.ts` has no rows for `gpt-6-luna` or `gpt-6.1-terra`. With no row, `callCostCents` returns
  `undefined` and turn costs are unknown, which matters for plan limits and the usage page.
- Add one row for each model from the provider's official price page: input, output and cached input per million
  tokens, `validFrom` = today, and `source` = that page's URL. Do not invent numbers.
- If the page cannot be read, stop and put the question in `docs/FOR_YOU.md`. Give the per-token prices worked out
  from `usage.cost` in `docs/eval/runs/2026-11-23-04-28.json` as the suggested values, clearly marked as derived.
- Add a test that `callCostCents('gpt-6-luna', today, …)` is a number.

### 3. Ask the owner to run the routed test

Give the owner this one command to run on `main` after PR 1 merges, and ask for the new `docs/eval/runs/` file:

```
ASSISTANT_EVAL_BASE_URL=https://api.arena.ai/v1 \
ASSISTANT_EVAL_ROUTED=gpt-6-luna,gpt-6.1-terra \
ASSISTANT_EVAL_MODELS=gpt-6-luna,gpt-6.1-terra \
ASSISTANT_EVAL_REPEATS=3 ASSISTANT_EVAL_MAX_CALLS=900 \
npx tsx scripts/assistant-model-eval.ts --write
```

Switch only if the routed row is correct on at least as many questions as Terra alone, minus 1 per 12. If it
scores lower, read the run file, find the cause, fix it, and run again.

### 4. Switch the site (settings only, no code)

The code already supports this (`assistantModels`, `routedModelClient`). On the Vercel project, set these for
**Production and Preview**:

| variable | value |
|---|---|
| `ASSISTANT_MODEL_BASE_URL` | `https://api.arena.ai/v1` |
| `ASSISTANT_MODEL_SIMPLE` | `gpt-6-luna` |
| `ASSISTANT_MODEL_STRONG` | `gpt-6.1-terra` |
| `ASSISTANT_MODEL_OCR` | `gpt-6-luna` |
| `ASSISTANT_MODEL_API_KEY` | the owner adds this themselves in Vercel → Settings → Environment Variables (sensitive) |

- Never ask for the key in chat, and never write it in a file or a commit.
- Leave the Gemini key in place: with both models on Arena, `routedModelClient` no longer needs Gemini.
- Redeploy, then check:
  1. On the live site, open a sandbox and ask "Who owes me money?". The router answers it with no model call.
  2. Ask "Why is my profit lower than last month?". The answer must give figures, and the stored turn metric must
     show `model: gpt-6.1-terra` with a non-null `costCents`.
  3. Ask "Record a payment of 500 from Acme Ltd for INV-1001". It must show `gpt-6-luna` and ask Bank or Cash.
  4. In the Vercel runtime logs, check for errors from `api.arena.ai` (401 means the key is wrong; 404 means the
     model name is wrong).
- If anything fails, remove the three model variables. The site falls back to the Gemini defaults at once, with
  no code change.

### 5. Record it

- `docs/FOR_YOU.md`: the switch was made, the routed score and cost, and how to undo it (remove the variables).
- `docs/TRACKER.md`: tick SBX-2 Part 6 "model choice".
- Update the header of `assistantModels.ts`: it names the Gemini models as the defaults. Leave the defaults alone,
  and add a note that production runs Luna/Terra through the environment variables.
