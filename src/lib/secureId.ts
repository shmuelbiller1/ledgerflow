/** Generate identifiers for durable client records without a low-entropy Math.random fallback.
 * getRandomValues also works in browsers where randomUUID is restricted to secure contexts. */
export function secureId(prefix: string, source: (Pick<Crypto, 'getRandomValues'> & { randomUUID?: () => string }) | null = globalThis.crypto ?? null): string | null {
  if (!source) return null;
  if (typeof source.randomUUID === 'function') {
    try { return `${prefix}${source.randomUUID()}`; } catch { /* try getRandomValues instead */ }
  }
  try {
    const bytes = source.getRandomValues(new Uint8Array(16));
    return `${prefix}${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return null;
  }
}
