# Runbooks

Short, checkable steps for the things that go wrong in production. Each page is written so a
non-coder can follow it: every step says what to open and what a healthy answer looks like.

| When | Page |
|---|---|
| Someone cannot sign in, or is locked out by two-step login | [sign-in-fails.md](sign-in-fails.md) |
| The app loads but nothing saves; figures are missing | [database-down.md](database-down.md) |
| Invoice emails, reminders or invites do not arrive | [emails-stop.md](emails-stop.md) |
| A deployment fails while a database migration is applied | [migration-fails.md](migration-fails.md) |
| A bank feed stops importing, or asks to reconnect | [bank-connection-breaks.md](bank-connection-breaks.md) |
| A key leaks, someone sees the wrong books, an account is taken over, or AI/billing spikes | [incident.md](incident.md) |

**One place to look first, always:** the public status page **`/status`** (its data is
`GET /api/v1/public/status`; a plain liveness answer is `GET /api/health`). It reports, without any
sign-in and without any customer data:

- **App and server** — answering or not;
- **Database** — answering, slow (over 2 s), or down;
- **Scheduled jobs** — last daily run, and which job failed if one did;
- **Sign-in / Email / Card payments / Bank feeds** — set up on this installation or not.

If a page here says "check the status page", that is this one. It caches for 30 seconds, so reload
after half a minute.

## Ground rules that apply to every runbook

1. **Do not "fix" money.** Never edit amounts, entries, invoices or balances by hand in the database
   to get a screen right — a correction is a reversal and a repost, through the app. Money, posting
   and `src/server/` belong to the lead (AI #1); report and wait rather than patching.
2. **Write down what you saw** (time, workspace, exact message) before trying anything: an incident
   with no record cannot be explained to a customer or an accountant later.
3. **A restore is a last resort.** Restoring a backup replaces live records (see
   `docs/verification/d98-backup-restore.md` for exactly what it does and does not verify). Export a
   fresh backup first, and get the owner's agreement in writing.
4. **Escalate early.** The owner is the only one who can change deployment settings, secrets and the
   database. If a step needs a secret you do not have, stop and hand it over.
