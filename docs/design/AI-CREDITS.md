# AI credits: one way to price, meter and show AI usage

Owner's request (26 Nov 2026): work out how AI use is charged. Measure what each call really costs us,
add a markup (failed calls can't be charged), turn it into points the customer can see, give each plan
a default amount, and let the admin override a workspace (for example "treat as paid").

## What happens today: three meters that disagree

| Meter | Used by | What it charges | Problem |
|---|---|---|---|
| `computeCreditBalance` ("compute credits") | `/api/v1/ai` tasks (receipts, forecasts, chat…), the brain route, developer classify | A **fixed weight per task** (`TASK_WEIGHTS`: a receipt is 150, a forecast 300, a strategic analysis 500). The brain route charges the **raw token count** as credits. | Not tied to what the call cost us. A workspace with no balance set gets **100,000 free credits** by default. |
| `apiQuotaTotalCentsUsed` | brain route, developer API | Cents, times the admin multipliers | Grows forever; nothing blocks on it, and the customer never sees it. |
| Assistant plan meter (SBX-2 Part 7) | the in-app assistant | The **real model cost** in cents, capped per month by plan (Free 25¢, Growth 500¢, Pro 2,500¢, Enterprise 12,500¢) | The only meter that's right, but it's separate from the other two. |

So the same customer can run out of one, have plenty of another, and see none of them. The admin
"credit balance" (AUP-04) is a **derived** number (base plus sharded counters), which is why editing
it was unsafe.

## The design: one AI credit balance, priced from real cost

### 1. Measure the real cost of every call (already built)
Every model call goes through the AI gateway, which records the model and the tokens and prices them
from the dated price table (`src/lib/ai/modelPricing.ts`). A model with no price row **cannot be used for
paid AI** until it has one: its cost is never guessed, and it is never given away by accident.

### 2. Price = cost × (1 + markup)
- **Default markup: 20%** (admin setting, global, with an optional per-workspace override).
- **Failed calls are never charged.** If the provider errors or times out, the customer pays nothing,
  and the markup is what covers the money we lost on those calls.
- **Why 20% and not 10%:** in our own model test (`docs/eval/runs`), some models failed to finish 17–33%
  of the hard questions. A failed call still burns tokens we pay for. 10% would often not cover that.
  The admin page shows the **measured failure overhead** each month (cost of failed calls ÷ cost of
  charged calls), so the markup can be set from facts, not a guess.
- Answers the books give without a model (code answers, the cache) cost nothing and are free, as today.
- **Own API key:** a workspace using its own provider key pays the provider directly, so its calls
  cost **0 credits** (the admin can still set a small platform fee per call).

### 3. Show it as AI credits
- **1 AI credit = $0.001** (a tenth of a cent) of price. Whole numbers are easy to read: "4,320 AI credits
  left this month".
- The ledger keeps the exact amount (to a millionth of a dollar), so a tiny call (0.06¢) is charged
  0.6 of a credit, not rounded up to 1. The screen rounds the **balance** down.
- What that means in practice (assistant, from the model test's average costs of 0.14¢ and 1.24¢ a turn):
  a simple question on the cheap model is about **1.7 credits**, and a hard one on the strong model about **15 credits**.

### 4. Where credits come from, in this order of use
1. **Monthly included credits** from the plan. They reset on the 1st (UTC) and do not roll over.
2. **Granted credits** from the admin (a gift, a goodwill credit, a trial). They don't expire unless the
   admin sets a date.
3. **Purchased credits** (top-up packs, phase 2). They don't expire.

| Plan | Price | Included AI credits per month | About |
|---|---|---|---|
| Free | $0 | **250** | ~150 simple or ~17 hard assistant questions, enough to try it |
| Growth | $29 | **5,000** | ~3,000 simple / ~340 hard |
| Pro | $99 | **25,000** | ~15,000 simple / ~1,700 hard |
| Enterprise | $299 | **125,000** | custom by agreement |

These carry over today's assistant caps (25¢ / 500¢ / 2,500¢ / 12,500¢ of cost) as credits of price,
so nobody's allowance changes shape. Enterprise's 125,000 is about 42% of its price in AI cost at most;
see the owner decision below.

### 5. When credits run out
The AI asks are refused with a clear message ("You've used this month's AI credits. They reset on
1 December, or buy more in Settings → Billing"). Everything that doesn't need a model keeps working.
Before a call, an estimate is **reserved** so two people at once can't overspend; after the call the
real price is charged and the rest of the reservation released.

### 6. Admin overrides per workspace (all audited)
- **Treat as plan:** give a workspace another plan's allowance without paying (for example "Pro, comped").
- **Unlimited AI:** no AI limit (today's `bypassBilling`, limited to AI).
- **Grant credits:** add N credits, optionally with an expiry date and a note.
- **Markup override:** for example 0% for a partner.

The admin never types a "balance". It is always calculated: included + granted + purchased − used.
This also answers **AUP-04**: the admin edits what goes *in* (plan, grants, markup), never the derived
total, so nothing can be counted twice.

### 7. What the customer sees
Settings → Billing → **AI credits**: credits left this month, when they reset, any granted or purchased
credits, and usage by feature (assistant, receipt reading, forecasts…) for this month and the last.

### 8. One ledger
Every charged or refused call writes one row: workspace, person, feature, model, tokens, **cost**,
**price**, **credits**, and whether it succeeded. The customer's screen, the admin's screen and the
failure-overhead number all read from it, so they can never disagree.

## Building it

**Phase 1 (one PR):**
- the credit ledger table (a migration, applied after merge)
- the metering service: reserve, then settle
- every AI route moved onto it, with `TASK_WEIGHTS`, the 100,000 default and the token-count credits removed
- the plan allowances
- the admin overrides and the failure-overhead number
- the customer's AI credits panel
- tests

The old counters stay readable for the history, but nothing charges them any more.

**Phase 2:** top-up packs through Stripe checkout (needs Stripe products, which only you can create).

## Owner decisions (defaults in use until you say otherwise)
1. **Markup:** 20%. Admin-editable.
2. **1 credit = $0.001.**
3. **Monthly allowances** as in the table above.
4. **Enterprise's 125,000 credits:** worth up to ~$104 of our cost against $299. Keep it, or lower it to
   50,000?
5. **Top-up prices (phase 2):** at face value, 10,000 credits for $10.
