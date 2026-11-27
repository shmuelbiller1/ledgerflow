# New assistant rules, checked on Luna (27 Nov 2026)

Run: `docs/eval/runs/2026-11-27-03-02.json`. GPT-6 Luna ran with the new `assistant/SYSTEM_PROMPT.md`
on the 15 questions it missed before (or that Terra fixed), plus 5 control questions it already got right.
Each question was asked 3 times. Graded with the graders on `claude/eval-luna-hard` (#1052). The test books
refuse what the live server refuses.

**Result: 44/45, for 5.74¢.**

| question | Luna before | Terra | Luna with the new rules |
|---|---|---|---|
| void a paid invoice | 0/2 | 0/2 | 3/3 |
| delete a customer who owes money | 0/2 | 0/2 | 3/3 |
| merge two different companies | 0/2 | 0/2 | 3/3 |
| customers owe in total | 1/2 | 2/2 | 3/3 |
| average monthly sales | 1/2 | 2/2 | 3/3 |
| cash after paying the bills | missed earlier | 2/2 | 3/3 |
| Hebrew: bank balance | missed earlier | 2/2 | 3/3 |
| Hebrew: overdue debts | 1/2 | 1/2 | 3/3 |
| total overdue | missed earlier | 2/2 | 3/3 |
| office costs to a new project | missed earlier | 2/2 | 2/3 |
| controls: payment, cash position, who owes most, refund too much, write-off | right | — | 15/15 |

With these rules, Luna got everything Terra fixed right, and also the three risky requests that Terra got
wrong. Only the "new project" question failed once.
