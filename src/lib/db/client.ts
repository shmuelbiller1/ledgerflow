import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import supabaseConfig from '../../../supabase-config.json';

// The project URL and publishable key are public (like the old Firebase web config).
// A build can point at another project with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
function readEnv(name: string): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.[name] || undefined;
  } catch {
    return undefined;
  }
}

// A local dev copy without its own project must never authenticate against the live project.
// Keep an inert valid URL so the guest/demo experience can start without remote credentials.
const unconfiguredLocalDev = readEnv('MODE') === 'development' &&
  (!readEnv('VITE_SUPABASE_URL') || !readEnv('VITE_SUPABASE_PUBLISHABLE_KEY'));
export const SUPABASE_URL = unconfiguredLocalDev
  ? 'https://ledgerflow-unconfigured.invalid'
  : (readEnv('VITE_SUPABASE_URL') || supabaseConfig.url);
export const SUPABASE_PUBLISHABLE_KEY = unconfiguredLocalDev
  ? 'ledgerflow-dev-not-configured'
  : (readEnv('VITE_SUPABASE_PUBLISHABLE_KEY') || supabaseConfig.publishableKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const isTest = process.env.NODE_ENV === 'test';
    const isBrowser = typeof window !== 'undefined' && !isTest;
    const instance = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: isBrowser,
        autoRefreshToken: isBrowser,
        detectSessionInUrl: isBrowser,
        ...(isTest ? {
          storage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          },
          lock: async (_name, _timeout, fn) => fn(),
        } : {}),
      },
    });
    if (isTest) {
      instance.auth.dispose = async () => {};
      instance.realtime.disconnect = async () => {
        try {
          (instance.realtime as unknown as { _terminateWorker?: () => void })._terminateWorker?.();
          (instance.realtime as unknown as { _cancelPendingDisconnect?: () => void })._cancelPendingDisconnect?.();
        } catch { /* ignore */ }
        return 'ok';
      };
    }
    client = instance;
  }
  return client;
}
