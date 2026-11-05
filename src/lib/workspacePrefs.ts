import type { MoneyDisplaySettings } from './moneyFormat';

/**
 * Environment-neutral hook for active workspace display/timezone preferences in the browser.
 * On the server this reader is never registered: server routes and services pass workspace
 * timezone, currency, and moneyDisplay explicitly from trusted database/request context.
 */
export interface WorkspaceRuntimePrefs {
  timezone?: string;
  currency?: string;
  moneyDisplay?: MoneyDisplaySettings;
}

type BrowserPrefsReader = () => WorkspaceRuntimePrefs | undefined;

let browserPrefsReader: BrowserPrefsReader | null = null;

export function registerBrowserWorkspacePrefs(reader: BrowserPrefsReader | null): void {
  browserPrefsReader = reader;
}

export function readBrowserWorkspacePrefs(): WorkspaceRuntimePrefs | undefined {
  if (!browserPrefsReader) return undefined;
  try {
    return browserPrefsReader();
  } catch {
    return undefined;
  }
}
