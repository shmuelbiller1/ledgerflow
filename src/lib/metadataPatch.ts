/**
 * Apply a top-level metadata patch. `null` removes one editable key; protected subtrees are
 * preserved from the saved record and cannot be written through profile metadata updates.
 */
export function mergeMetadataPatch(
  currentValue: unknown,
  updates: Record<string, unknown>,
  protectedKeys: readonly string[] = [],
): Record<string, unknown> {
  const current = currentValue !== null && typeof currentValue === 'object' && !Array.isArray(currentValue)
    ? currentValue as Record<string, unknown>
    : {};
  const protectedFields = new Set(protectedKeys);
  for (const key of Object.keys(updates)) {
    if (protectedFields.has(key)) {
      throw new Error('Protected metadata can only be changed through its dedicated workflow.');
    }
  }
  const merged = new Map(Object.entries(current));
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) merged.delete(key);
    else merged.set(key, value);
  }
  // Retain the authoritative protected subtrees even if an unexpected caller tries to replace them.
  for (const key of protectedFields) {
    if (Object.hasOwn(current, key)) merged.set(key, current[key]);
  }
  return Object.fromEntries(merged);
}
