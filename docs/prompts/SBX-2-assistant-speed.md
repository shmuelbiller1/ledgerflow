# SBX-2 — make the assistant fast and cheap (owner's prompt, 22 Nov 2026)

**Owner of this task:** AI #1 (lead). Starts after PR #996 is merged.

## Your task

The assistant's sandbox (SBX-1) is built. Now make the assistant answer quickly and cheaply, without
making it less correct. Measure first, then change only what the numbers show is slow or costly.
Do not change posting, tax, or report math, and do not let any speed-up write to the real books.

## Read first, in this order

1. `docs/prompts/SBX-1-assistant-sandbox.md` and `docs/design/SBX-1-overlay.md` (what the sandbox is).
2. `docs/prompts/CMD-1-checklist.md` part 3 (assistant token, proposals, tools, `assistant/tools.json`,
   system prompt). If those are not finished, finish only what you need, with the CMD-1 agent's lane
   in mind: do not duplicate their work, read `git log origin/main` first.
3. `src/server/services/aiGateway.ts`, `aiBackendService.ts`, `sandboxTools.ts`, `src/lib/ai/modelPricing.ts`.
   Find where the assistant calls a model today. If there is no assistant chat loop yet, say so in
   your first PR description and build the thinnest loop that parts 2 to 7 need.

## Part 1 — Measure first (one PR, before anything else)

- For every assistant turn, record: which path answered (code, memory, cache, model), which model,
  input and output tokens, tools offered, tools called, time to first word, total time, cost in cents
  (use `callCostCents`; a model with no price row records tokens and an unknown cost, never a guess).
- **Privacy:** the measurement never stores the question text, the answer text, amounts, names or any
  other book data. Only the path, model, counts, times and cost, tagged with the workspace id.
- A small script that replays 30 realistic questions (balances, who owes me, a customer invoice, a
  payment, a report, a vague one) and prints a table per path. **It runs only on a sample/test
  workspace (seeded test data), never on a real customer's books.** Commit the first run's numbers to
  `docs/` so every later part can show before and after.

## Part 2 — Answer without the model when code can

- A router in front of the model: questions the books can answer exactly (cash balance, who owes
  me, this month's sales, an invoice by number, "explain this number") go straight to the existing
  read tools (`ask_books`, `run_report`, `explain_number`, `get_record`, `calculate`) and are worded from a
  fixed template, with the source cited. The model is called only when the router cannot decide.
- The router must say "not sure" often rather than guess. A wrong answer from code is worse than a
  slow answer from the model. Test: a list of questions that MUST go to the model, and a list that MUST
  not, both pinned.

## Part 3 — Remembered decisions

- When the person accepts a proposed step the same way repeatedly (same payee, same account, same
  tax code), remember it per workspace and propose it first next time, marked "from your earlier
  choice". Use accept rates: only offer it above a set rate (for example 95% over at least five
  cases), and show how many cases it came from. Never auto-accept. Never carry a decision to another
  workspace. A person can see and delete what is remembered.

## Part 4 — Caching

- Cache read results and report answers per (workspace, sandbox, question's inputs), and drop them
  when the real books or the sandbox change. SBX-1's version tracking says when something changed;
  use it, do not invent a second clock. Test: a real save invalidates the cache before the next read.
- Provider prompt caching for the fixed part of every request (system prompt, tool definitions), and
  keep that part byte-identical between turns so the cache hits.

## Part 5 — Fewer tools per request

- Offer about 25 tools at a time plus `find_command(words)`, which searches the full command list and
  returns the few that match. Pick the 25 from the question's area (invoices, bank, inventory,
  reports…). A test proves every command can still be reached through `find_command`.
- Tool descriptions come from the commands' own `describe` (generated, never hand-copied).

## Part 6 — Two models, and the right model for OCR

- A cheap fast model for simple turns and a stronger one only when the turn needs it (several
  dependent steps, an ambiguous request, a high-risk action). Choose by a written rule, not by feel,
  and log which one answered.
- Receipts and invoice images go to a vision/OCR-capable model, in a separate small service, with its
  result shown to the person as a draft to accept or edit, never posted.
- Do not guess prices or model names. Read each provider's current pricing page, add a dated row to
  `MODEL_PRICES` with the source URL (the same way the existing row is done), and say in the PR which
  models you compared and why you picked these two.
- **Providers:** use Gemini models (Flash for simple turns) — Google is already the app's AI provider.
  The owner also named GLM Flash models: compare them on price and quality in the PR, but **do not send
  any book data to GLM (or any provider other than Google) until the owner approves it in
  `docs/FOR_YOU.md`** — a new provider receives customers' bookkeeping data, which is a privacy and
  contract decision.
- **Update 22 Nov (owner):** providers other than Google are now **approved** (`docs/FOR_YOU.md`), so
  models reached through Arena may be compared and used. Test on the replay's test books first; real
  books only after the comparison shows the chosen model is good enough.
- **How to run the comparison (already built in Parts 1–2):** the owner adds an Arena API key as a
  network secret for host `api.arena.ai` (header `Authorization: Bearer …`; the proxy adds it, no agent
  sees it). Then run, once per candidate model:
  `ASSISTANT_REPLAY_MODEL=<model> ASSISTANT_REPLAY_BASE_URL=https://api.arena.ai/v1 npx tsx scripts/assistant-replay.ts`
  It replays 30 typical questions (9 answered by code, the rest by the model) through
  `openAiCompatibleClient` and prints model calls, tokens, tools called, time and cost per path.
  Candidates the owner named: GPT-6 Luna, GPT-6.1 Terra, a Gemini Flash, a GLM Flash, plus the cheapest
  models on Arena's tool-efficiency leaderboard. Add each model's price row before trusting its cost.
- **The graded comparison (one command, rerun it to update):**
  `ASSISTANT_EVAL_BASE_URL=https://api.arena.ai/v1 ASSISTANT_EVAL_MODELS=<m1>,<m2> ASSISTANT_EVAL_OCR_MODELS=<m1>,<m2> npx tsx scripts/assistant-model-eval.ts --write`
  It grades 12 model questions against a sample company (`scripts/eval/`): the right step drafted, the
  right figure stated, or a question asked instead of a guess. It also scores receipt reading (OCR) on 4
  generated receipts whose true values are known, one model per run with no fallback, and records the
  billed cost. The newest run goes on top of `docs/assistant-model-eval.md`. `--self-test` checks the
  graders without a key.
- **Output:** the before/after table in `docs/assistant-baseline.md`, and a short recommendation in
  `docs/FOR_YOU.md` (cheap model, strong model, the written rule for switching, cost per 100 questions).
- **Blocked until:** the Arena key is saved (a new session's key form works; this one's did not).

## Part 7 — Plans and limits

- Count assistant use per workspace (turns, tokens, cents) against the plan, using the existing plan
  meter (`src/server/middleware/planCapacity.ts`). Show the person what they have used. Refuse
  politely at the limit; never silently switch to a cheaper model.

## Rules

- Follow CLAUDE.md: a branch and a pull request, CI green, answer the review comments. One part per PR.
- Never log or cache anything outside its workspace. Redact as `sandboxTools.ts` does.
- The assistant token and sandbox boundaries from SBX-1 do not change: nothing here may write to the
  real books or accept a step for the person.
- Every part shows its before and after from the Part 1 table. A part that does not move a number is
  not merged — **except Part 1 (the measuring itself) and Part 7 (plan limits)**, which are not meant
  to make anything faster; they must still not make the numbers worse.

## Done when

- The Part 1 table exists with before and after for each part.
- At least half of the replay questions that code can answer are answered without a model call,
  with the pinned must-go-to-the-model list still going to the model.
- A real save invalidates cached answers; a remembered decision never auto-accepts; the full command
  list is reachable through `find_command`.
- Two models are in use with a written rule, priced rows with sources are in `modelPricing.ts`, and
  OCR results are drafts only.
- `docs/TRACKER.md` and `docs/FOR_YOU.md` say what is done and what needs the owner (provider keys,
  plan limits, any non-Google provider).
