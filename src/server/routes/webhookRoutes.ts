import type express from "express";
import { registerStripeWebhookRoutes } from "./stripeWebhookRoutes.ts";
import { registerPlaidWebhookRoutes } from "./plaidWebhookRoutes.ts";

/** Webhooks signed over the raw body (Stripe, Plaid AU-1): registered before the JSON parser. */
export function registerWebhookRoutes(app: express.Express, ctx: Parameters<typeof registerStripeWebhookRoutes>[1]): void {
  registerStripeWebhookRoutes(app, ctx);
  registerPlaidWebhookRoutes(app);
}
