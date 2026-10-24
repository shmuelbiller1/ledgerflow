import { REPORT_TABS_REGISTRY, SCREEN_TABS_REGISTRY, SETTINGS_TABS_REGISTRY } from '../config/registry';
import { normalizePinned, pageKey, type PinnedPage } from './pinnedPages';

export const MAX_RECENT_REPORTS = 5;
export const RECENT_REPORTS_KEY = 'lf_recent_reports';
export const PINNED_PAGES_KEY = 'lf_pinned_pages';

export interface ReportPreferences {
  recentReportIds: string[];
  pinnedPages: PinnedPage[];
}

export interface ReportPreferenceSnapshot extends ReportPreferences {
  updatedAt?: string;
}

export interface LocalReportPreferences extends ReportPreferences {
  /** A device edit that has not been acknowledged by the sync write must survive a reload. */
  pendingSync: boolean;
}

export type ReportPreferencesSyncStatus = 'device' | 'loading' | 'saving' | 'synced' | 'error';

const VALID_REPORT_IDS: ReadonlySet<string> = new Set(REPORT_TABS_REGISTRY.map(report => report.id));
const VALID_PAGE_KEYS: ReadonlySet<string> = new Set([
  ...SCREEN_TABS_REGISTRY.map(tab => tab.id),
  ...REPORT_TABS_REGISTRY.map(report => pageKey({ tab: 'reports', sub: report.id })),
  ...SETTINGS_TABS_REGISTRY.map(settings => pageKey({ tab: 'settings', sub: settings.id })),
]);

/** Recent IDs are bounded, unique and limited to reports that still exist. */
export function normalizeRecentReports(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && VALID_REPORT_IDS.has(id)))].slice(0, MAX_RECENT_REPORTS);
}

/** Only registered internal pages can be restored from a remote or local preference record. */
export function normalizeReportPreferences(value: unknown): ReportPreferences {
  if (!value || typeof value !== 'object') return { recentReportIds: [], pinnedPages: [] };
  const record = value as Partial<ReportPreferenceSnapshot>;
  return {
    recentReportIds: normalizeRecentReports(record.recentReportIds),
    pinnedPages: normalizePinned(record.pinnedPages, VALID_PAGE_KEYS),
  };
}

export function parseRecentReports(raw: string | null): string[] {
  try {
    return normalizeRecentReports(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function sameReportPreferences(a: ReportPreferences, b: ReportPreferences): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** User and workspace are both in the key: one person's books never inherit another's local cache. */
export function localReportPreferencesKey(uid: string, workspaceId: string): string {
  return `lf_report_preferences_v1:${encodeURIComponent(uid)}:${encodeURIComponent(workspaceId)}`;
}

/**
 * Stable across devices without leaking either ID into the profile field key. Hashing also handles
 * the maximum legal workspace ID without truncation, dots, or composite-key collisions.
 */
export async function reportPreferenceScopeKey(uid: string, workspaceId: string): Promise<string> {
  if (!uid || !workspaceId) throw new Error('A signed-in user and workspace are required to sync report preferences');
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot create a secure report-preference key');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([uid, workspaceId])));
  return `rp_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
