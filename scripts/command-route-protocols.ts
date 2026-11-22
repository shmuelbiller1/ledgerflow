/** Reviewed protocol boundaries, not a scanner exclusion list. These sites stay in the raw
 * non-command count. Each reason and its regression evidence apply to exactly one registration. */
export interface CommandRouteProtocol {
  file: string;
  method: 'post' | 'patch' | 'put' | 'delete';
  route: string;
  /** For a path expression, match its exact source (not a substring or a directory prefix). */
  expression?: true;
  why: string;
  tests: readonly string[];
}

function post(file: string, route: string, why: string, ...tests: string[]): CommandRouteProtocol {
  return { file: `src/server/routes/${file}Routes.ts`, method: 'post', route, why, tests };
}

export const COMMAND_ROUTE_PROTOCOLS: readonly CommandRouteProtocol[] = [
  post('document', '/:type/:id/pdf', 'A member requests rendered bytes, not a ledger change. Only an issuing print may claim the original; replay must render a copy, not return a cached original. A viewer or preview never consumes it.', 'document-pdf-route.test.ts', 'copy-mark.test.ts'),
  post('document', '/zip', 'Issues a collection of independent copies/originals and returns a binary archive, omitting missing or out-of-scope documents. Each eligible document has its own first-issue transaction; do not reserve all originals in a pretend atomic batch.', 'document-pdf-route.test.ts', 'copy-mark.test.ts'),
  post('openItemImport', '/confirm', 'Validates the file first, then posts each accepted opening item with its own source identity and transaction. A later failure can leave earlier rows posted. Retrying the file recognizes the imported items, not a cached batch answer.', 'eg14-open-item-import.test.ts'),
  post('repost', '/', 'Runs queued accounting corrections per key, with strict-lock refusals and partial results. Corrections are keyed to the work and current books; retrying clean work cannot repost it. An outer command transaction would change the failure and lock contract.', 'eg1-stock-cost-repost.test.ts'),
  post('plaid', '/exchange_public_token', 'Consumes a one-time Link credential at Plaid, stores the encrypted connection, then primes its provider cursor. Reusing a LedgerFlow operation ID cannot make a consumed Plaid credential usable again.', 'plaid.test.ts', 'plaid-sync-ingest.test.ts'),
  post('plaid', '/disconnect', 'Stops the provider item before deleting the local connection, with special handling for an item the provider already removed. Provider failure leaves the connection; imported lines are retained in either case.', 'plaid.test.ts'),
  post('plaid', '/sync', 'Uses one bank lease, provider paging and its cursor per connection. A partial result across banks is intentional; storing lines and moving the cursor cannot be replaced by a cache keyed to the HTTP request.', 'plaid.test.ts', 'plaid-sync-ingest.test.ts'),
  post('plaidWebhook', '/api/webhook/plaid', 'Verifies a provider signature and digest over raw bytes before resolving the item. Uses the same paged cursor/lease protocol as sync; a failed sync asks Plaid to retry, not a workspace member to resubmit.', 'plaid-webhook.test.ts'),
  post('billing', '/verify-session', 'The owner asks Stripe to reconcile a paid Checkout session for this workspace. The provider session claim, rather than a caller-supplied operation key, governs repeat verification and credit provisioning.', 'cmd1-protocol-boundaries.test.ts', 'server-write-roles.test.ts'),
  post('publicInvoice', '/:token/pay', 'Uses the recipient payment link to open Stripe Checkout. Stripe deduplicates the session for the same amount and parameters; no local payment or journal posts until a separate authenticated provider event.', 'int6-checkout-idempotency.test.ts', 'validation-guard.test.ts'),
  post('stripeWebhook', '/api/webhook/stripe', 'Dispatches signed raw provider events, not commands by a book member. Stripe event/session/payment identities control settlement, retries and asynchronous payment failures.', 'int6-checkout-idempotency.test.ts', 'online-payments.test.ts', 'payment-failures.test.ts', 'security-s16-s18-s34-data-protection.test.ts'),
  post('email', '/invoices/:invoiceId', 'Delivery is an external send with a PDF and recipient/suppression checks. Provider outcomes are recorded after delivery; a retry is a deliberate resend unless suppressed, not an atomic ledger update.', 'emails.test.ts'),
  post('email', '/statements', 'Delivers to eligible recipients individually, reporting sent, skipped and failed outcomes. The mail provider cannot be rolled back if a later recipient is refused.', 'emails.test.ts'),
  post('email', '/', 'Accepts secret-authenticated provider reports and correlates them to sent message IDs and address suppression. No person can draft a provider delivery callback.', 'emails.test.ts', 'email-webhook-csrf.test.ts', 'security-s16-s18-s34-data-protection.test.ts'),
  post('estimateSign', '/:token/sign', 'The recipient, not a workspace writer, signs the estimate with a scoped link, consent and signer details. It consumes the link once and preserves the signature evidence; a workspace command must not impersonate the recipient.', 'estimate-signature.test.tsx'),
  post('ai', '/process', 'Executes a bounded model task with membership, compute debit/refund, provider failure handling and traces. It returns model output (including OCR suggestions) without saving the suggested book changes; retry runs a fresh metered task.', 'cmd1-protocol-boundaries.test.ts', 'security-s16-s18-s34-data-protection.test.ts'),
  post('brain', '/api/v1/brain/analyze', 'Returns model analysis of ephemeral data or scoped books. Usage is measured from the provider call and traced independently; retry requests another analysis, not a book mutation or cached decision.', 'cmd1-protocol-boundaries.test.ts', 'brainAnalyze.test.ts'),
  post('brain', '/api/v1/brain/classify', 'Returns a classification suggestion, not a rule or a posting. Usage and counters record the actual classification execution; each retry is another sample.', 'cmd1-protocol-boundaries.test.ts'),
  post('developerApi', '/api/v1/brain/classify-batch', 'Returns suggestions and hypothetical account matches for bounded input rows. Bills for the computation, but never changes these entries or confirms any suggestion.', 'cmd1-protocol-boundaries.test.ts'),
  post('auth', '/api/v1/auth/revoke-sessions', 'Removes the person’s auth sessions (all, or one named sessionId of their own, S-28) first, then records audits in their owned books. Run this at the identity boundary without postponing revocation until workspace audit writes succeed.', 'cmd1-protocol-boundaries.test.ts', 'preflight-and-auth-limiter.test.ts', 'auth-sessions-945.test.ts'),
  { file: 'src/server/routes/authRoutes.ts', method: 'delete', route: '/api/v1/auth/delete-account',
    why: 'Account erasure may leave several books or schedule sole-owner books for purge before removing sign-in at the provider. Preserves the co-ownership guard and the cross-workspace lifecycle, not a single-book commit.', tests: ['cmd1-protocol-boundaries.test.ts', 'account-deletion.test.ts'] },
  post('auth', '/api/v1/auth/audit', 'Captures a sign-in/out/refresh event for the authenticated identity, not a caller-chosen audit actor or accounting event. Each event has a distinct security-log identity.', 'cmd1-protocol-boundaries.test.ts', 'server-write-roles.test.ts'),
  { file: 'src/server/routes/cspReportRoutes.ts', method: 'post', route: 'CSP_REPORT_PATH', expression: true,
    why: 'Anonymous user-agent reports update bounded in-memory measurement counters and always acknowledge with 204. They do not open a workspace or persist to its books.', tests: ['csp-report-only.test.ts'] },
  { file: 'src/server/routes/cspReportRoutes.ts', method: 'delete', route: '${CSP_REPORT_PATH}/summary', expression: true,
    why: 'Only a signed-in platform admin can reset the process-local CSP measurement. Repeated resets are harmless; there are no workspace or database records to audit.', tests: ['csp-report-only.test.ts', 'cmd1-protocol-boundaries.test.ts'] },
  post('telemetry', '/api/v1/telemetry/errors', 'Accepts optionally authenticated, bounded error telemetry and scrubs PII. A validated workspace is only an attribution label; retries can update the same trace ID, never book data.', 'cmd1-protocol-boundaries.test.ts', 'log-redaction.test.ts'),
];
