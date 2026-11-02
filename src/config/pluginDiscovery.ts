import type { ComponentType } from 'react';

/**
 * Discovers optional plugin modules under `src/plugins/*.tsx` via Vite's build-time glob.
 * Outside Vite (such as Node unit-test runners), safely returns an empty map.
 */
export function discoverPluginModules(): Record<string, () => Promise<{ default: ComponentType }>> {
  try {
    return import.meta.glob<{ default: ComponentType }>('../plugins/*.tsx');
  } catch {
    return {};
  }
}

/**
 * Extracts valid plugin route IDs from discovered `import.meta.glob` module keys,
 * ignoring documentation placeholders (`README`, `README.md`).
 */
export function extractPluginRouteIds(modulePaths: Iterable<string>): string[] {
  const ids: string[] = [];
  for (const modPath of modulePaths) {
    const fileName = modPath.split('/').pop()?.replace(/\.tsx$/, '') || '';
    if (fileName && fileName !== 'README' && fileName !== 'README.md') {
      ids.push(fileName);
    }
  }
  return ids;
}
