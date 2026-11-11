import { guestSession } from './db/guestDatabase';

/**
 * Defense in depth for the sample company: legacy screens still contain API-only actions.
 * Fail closed BEFORE a request is sent, rather than posting an anonymous sample to a server.
 * This is a demo-mode transport guard, NOT authorization (server/RLS checks remain unchanged).
 * Installed once at browser bootstrap, before SDKs can capture fetch. Local DB/posting/numbering
 * transports do not use fetch. Module/image/font loading is unaffected.
 */
export function installGuestNetworkGuard(target: typeof globalThis = globalThis): () => void {
  const original = target.fetch;
  const guarded: typeof fetch = (input, init) => {
    if (guestSession()) return Promise.reject(new Error('This action needs a signed-in workspace. Nothing was sent from the sample company.'));
    return original.call(target, input, init);
  };
  target.fetch = guarded;
  const xhr = target.XMLHttpRequest?.prototype;
  const originalSend = xhr?.send;
  if (xhr && originalSend) xhr.send = function(body) {
    if (guestSession()) throw new Error('This action needs a signed-in workspace. Nothing was sent from the sample company.');
    return originalSend.call(this, body);
  };
  return () => {
    if (target.fetch === guarded) target.fetch = original;
    if (xhr && originalSend) xhr.send = originalSend;
  };
}
