import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { SecurityService } from '../../services/securityService';
import type { Firestore } from '../db/firestore';
import { guardEffect } from './sandboxEffects';

/** Shared provider connection. Tests replace this client without loading any provider credentials. */
export type PlaidClientLike = Pick<PlaidApi, 'linkTokenCreate' | 'itemPublicTokenExchange' | 'transactionsGet'> & Partial<Pick<PlaidApi, 'itemRemove' | 'transactionsSync' | 'webhookVerificationKeyGet' | 'itemWebhookUpdate'>>;

let plaidClient: PlaidClientLike = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || "sandbox"],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
}));

export function setPlaidClientForTests(client: PlaidClientLike) {
  plaidClient = client;
}

/** The current Plaid client (provider services, routes and webhook share it). */
export function getPlaidClient(): PlaidClientLike {
  return plaidClient;
}

export function plaidErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
}

/** Best-effort provider registration, after the local connection and audit have committed. */
export async function registerPlaidItemWebhook(db: Firestore, bankId: string, encryptedToken: string, webhook: string) {
  guardEffect({ kind: 'bank', action: 'register-webhook', target: bankId }, db);
  const client = getPlaidClient();
  if (!client.itemWebhookUpdate) return;
  try {
    await client.itemWebhookUpdate({ access_token: SecurityService.decryptSensitiveField(encryptedToken), webhook });
    return { webhookRegistered: true };
  } catch (error) {
    console.error('[Plaid] item webhook update:', plaidErrorCode(error) || 'provider request failed');
    return { webhookRegistered: false };
  }
}
