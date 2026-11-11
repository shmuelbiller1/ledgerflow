# Load test: 50 users posting and reading reports (F-30)

**What it is for.** Answering "does the books' server stay quick with a bookkeeping team
working at the same time" — posting an entry and reading the two reports people open most
(P&L and trial balance). It is not a benchmark of the hosting provider and it does not
prove correctness; AU-3's stress tests do that.

**The script.** `perf/load-test.js`, run with [k6](https://k6.io/):

```sh
k6 run perf/load-test.js \
  -e BASE_URL=http://localhost:3000 \
  -e TOKEN=<a test user's token> \
  -e WORKSPACE_ID=<a disposable workspace> \
  -e DEBIT_ACCOUNT=<an expense account id> \
  -e CREDIT_ACCOUNT=<a bank account id> \
  -e DURATION=2m
```

**Never point it at real books.** Every entry it writes is named `Load test …` and is one
cent, but it still posts to the ledger door. Use a workspace made for the test and delete it
afterwards.

**Thresholds in the script**

| Measure | Budget |
|---|---|
| `http_req_duration` p95 | under 2 s |
| `http_req_failed` | under 1 % |
| 5xx responses | zero |

**Recording a run.** Add a dated section here with the machine, the workspace size, the
numbers and any failure. Do not compare runs from different machines as if they were the
same measurement.

## Runs

_No run recorded yet in this branch (AI #7, 19 Oct). The script and budgets are in place so
the first controlled run has somewhere to be written down._
