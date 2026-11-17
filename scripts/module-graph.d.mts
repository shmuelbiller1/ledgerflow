/** Types for scripts/module-graph.mjs — the import graph the quality metrics and the guard test read. */
export function getAllFiles(dir: string, fileList?: string[], skipDirs?: string[]): string[];
export function resolveImportPath(importerPath: string, importSource: string): string | null;
export function expandGlob(importerPath: string, globPattern: string): string[];
export function entryPoints(rootDir: string): string[];
export function reachableFiles(rootDir: string): Set<string>;
export const ORPHAN_IGNORED_FILES: string[];
export function orphanFiles(rootDir: string, notOrphans?: string[]): string[];
