import { createHash } from 'node:crypto';
import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('Payments are not set up yet (STRIPE_SECRET_KEY is missing).');
    stripeClient = new Stripe(key, { apiVersion: "2024-12-18.acacia" as Stripe.StripeConfig["apiVersion"] });
  }
  return stripeClient;
}

export type { Stripe };

/**
 * INT-6: the idempotency key a Checkout session is opened with. The same parts (the invoice or workspace and the
 * amount) give the same key, so a double click gets back the one session Stripe already opened instead of a second
 * payable one; a changed amount is a new key. Stripe keeps a key 24 hours, as long as a Checkout session stays open.
 */
export const checkoutIdempotencyKey = (...parts: Array<string | number>) =>
  `checkout_${parts.map(p => String(p).replace(/[^A-Za-z0-9_-]/g, '-')).join('_')}`.slice(0, 255);

/**
 * A short fingerprint of a Checkout request's parameters, added to its key: Stripe refuses a key reused with other
 * parameters, so an invoice renamed at the same amount would otherwise be locked out of paying for 24 hours.
 */
export const checkoutParamsFingerprint = (params: unknown) =>
  createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16);

/** Stripe refuses a key that is still being used by a request in flight (two clicks at once). */
export const isIdempotencyInFlight = (err: unknown) => {
  const e = err as { type?: string; code?: string } | null;
  return e?.type === 'StripeIdempotencyError' || e?.code === 'idempotency_key_in_use';
};

/** A Stripe reference as its id (webhook objects carry ids; expanded ones carry objects). */
export const stripeId = (ref: string | { id: string } | null | undefined): string | null => (typeof ref === 'string' ? ref : ref?.id ?? null);

/**
 * AUP-15: the one record that a checkout session's plan credits were granted. The verify-session route and the
 * checkout webhook both take it, inside the transaction that grants, so the credits are granted once whichever
 * arrives first. The `session_` prefix is the one verify-session already wrote, so earlier claims still count.
 */
export function checkoutSessionClaimId(sessionId: string): string {
  return `session_${sessionId}`;
}
