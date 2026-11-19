import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

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

/** The current Plaid client (the API, commands, and webhook share it). */
export function getPlaidClient(): PlaidClientLike {
  return plaidClient;
}

export function plaidErrorCode(err: unknown): string | undefined {
  return (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
}
