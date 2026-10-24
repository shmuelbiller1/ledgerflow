import { parsePinned, togglePinned, type PinnedPage } from '../lib/pinnedPages';
import {
  MAX_RECENT_REPORTS,
  normalizeRecentReports,
  parseRecentReports,
  RECENT_REPORTS_KEY,
  type ReportPreferencesSyncStatus,
} from '../lib/reportPreferences';
import { create } from 'zustand';
import type { AppTab, FilterCriteria } from '../types';
import { parseRecordHash, recordHash } from '../lib/recordLinks';
import { setDateDisplayFormat } from '../lib/utils';
import type { RecordRef } from '../lib/recordLinks';

/** A file being read into transactions (shown above the transaction list). */
export interface ParsingItem { id: string; name: string; status: 'uploading' | 'parsing' | 'done' | 'error'; idempotencyKey?: string }

/** A saved display choice, or the default when it is missing, unknown or storage is blocked. */
function storedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The tabs a workspace hides from the sidebar (Settings → Blueprint), saved per workspace. */
function storedHiddenTabs(workspaceId: string | null | undefined): string[] {
  try {
    const key = workspaceId ? `lf_hidden_tabs_${workspaceId}` : 'lf_hidden_tabs';
    let saved = localStorage.getItem(key);
    if (!saved && workspaceId) saved = localStorage.getItem('lf_hidden_tabs');
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const initialHash = typeof window !== 'undefined' ? parseRecordHash(window.location.hash) : { tab: '' };

interface UIState {
  activeTab: AppTab;
  /** The record a link (`#sales/invoice/<id>`) points to; its screen highlights and opens it (Z-32). */
  focusRecord: RecordRef | null;
  openRecord: (record: RecordRef) => void;
  clearFocusRecord: () => void;
  isSidebarOpen: boolean;
  isCompactMode: boolean;
  isProMode: boolean;
  /** Developer switch (Settings → Developer): shows demo screens that run on made-up data. Per device. */
  developerMode: boolean;
  setDeveloperMode: (on: boolean) => void;
  isQuickEntryOpen: boolean;
  isHealthCheckOpen: boolean;
  isCommandPaletteOpen: boolean;
  isImporterOpen: boolean;
  isQBOMigrationOpen: boolean;
  isTemplateSelectorOpen: boolean;
  isAIBlueprintOpen: boolean;
  isCommandCenterOpen: boolean;
  isConverterOpen: boolean;
  isIntegrityOpen: boolean;
  isEntanglementOpen: boolean;
  isDiagnosticConsoleOpen: boolean;
  isGuideOpen: boolean;
  isArchitectureOpen: boolean;
  isFocusMode: boolean;
  isPrivacyMode: boolean;
  isShortcutOverlayOpen: boolean;
  isOnline: boolean;
  isSyncing: boolean;
  language: 'en' | 'he';
  filterCriteria: FilterCriteria | null;
  parsingQueue: ParsingItem[];
  splittingTxId: string | null;
  isDevMode: boolean;
  theme: 'light' | 'dark' | 'system';
  isQuietMode: boolean;
  activeIntelChannel: string;
  lexiconOverrides: Record<string, { en: string; he: string }>;
  
  // Customization & Accessibility Preferences
  fontSizeScale: number; // 80 - 150 (%)
  fontSizePreset: 'small' | 'normal' | 'medium' | 'large' | 'xlarge';
  fontFamily: 'system' | 'inter' | 'jakarta' | 'serif' | 'mono';
  rowDensity: 'compact' | 'normal' | 'comfortable';
  accentColor: 'emerald' | 'indigo' | 'amber' | 'teal' | 'violet' | 'rose' | 'slate';
  highContrast: boolean;
  reduceMotion: boolean;
  defaultLandingTab: string;
  dateFormatPref: string;
  numberDecimals: number;

  // Actions
  setFontSizeScale: (scale: number) => void;
  setFontSizePreset: (preset: 'small' | 'normal' | 'medium' | 'large' | 'xlarge') => void;
  setFontFamily: (font: 'system' | 'inter' | 'jakarta' | 'serif' | 'mono') => void;
  setRowDensity: (density: 'compact' | 'normal' | 'comfortable') => void;
  setAccentColor: (color: 'emerald' | 'indigo' | 'amber' | 'teal' | 'violet' | 'rose' | 'slate') => void;
  setHighContrast: (val: boolean) => void;
  setReduceMotion: (val: boolean) => void;
  setDefaultLandingTab: (tab: string) => void;
  setDateFormatPref: (fmt: string) => void;
  setNumberDecimals: (num: number) => void;
  
  setActiveTab: (tab: AppTab) => void;
  setActiveIntelChannel: (channel: string) => void;
  activeSettingsTab: string;
  setActiveSettingsTab: (tab: string) => void;
  activeReportTab: string;
  setActiveReportTab: (tab: string) => void;
  navigateTool: (id: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (val: boolean) => void;
  toggleQuietMode: () => void;
  toggleFocusMode: () => void;
  setCompactMode: (val: boolean) => void;
  setProMode: (val: boolean) => void;
  setQuickEntryOpen: (val: boolean) => void;
  setHealthCheckOpen: (val: boolean) => void;
  setCommandPaletteOpen: (val: boolean) => void;
  setImporterOpen: (val: boolean) => void;
  setTemplateSelectorOpen: (val: boolean) => void;
  setAIBlueprintOpen: (val: boolean) => void;
  setCommandCenterOpen: (val: boolean) => void;
  setConverterOpen: (val: boolean) => void;
  setIntegrityOpen: (val: boolean) => void;
  setEntanglementOpen: (val: boolean) => void;
  setDiagnosticConsoleOpen: (val: boolean) => void;
  setGuideOpen: (val: boolean) => void;
  setArchitectureOpen: (val: boolean) => void;
  togglePrivacyMode: () => void;
  setShortcutOverlayOpen: (val: boolean) => void;
  setFilterCriteria: (val: FilterCriteria | null) => void;
  setIsOnline: (val: boolean) => void;
  setIsSyncing: (val: boolean) => void;
  setParsingQueue: (queue: ParsingItem[]) => void;
  setSplittingTxId: (id: string | null) => void;
  addParsingItem: (item: ParsingItem) => void;
  updateParsingItem: (id: string, updates: Partial<ParsingItem>) => void;
  setDevMode: (val: boolean) => void;
  setLexiconOverride: (key: string, lang: 'en' | 'he', value: string) => void;
  resetLexiconOverrides: () => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  hiddenTabs: string[];
  /** a workspace was opened: its own hidden tabs (they used to carry over from the last one) */
  loadHiddenTabs: (workspaceId: string | null) => void;
  toggleTabVisibility: (id: string) => void;
  speedDials: Record<string, string>;
  setSpeedDial: (key: string, tabId: string) => void;
  removeSpeedDial: (key: string) => void;
  /** Pinned pages (I-21/D-47): buttons on every page, Alt+1 … Alt+9. */
  pinnedPages: PinnedPage[];
  togglePinnedPage: (page: PinnedPage) => void;
  recentReports: string[];
  recordRecentReport: (reportId: string) => void;
  reportPreferencesStatus: ReportPreferencesSyncStatus;
  reportPreferencesDeviceError: boolean;
  goToPage: (page: PinnedPage) => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: (initialHash.tab || 'dashboard') as AppTab,
  focusRecord: initialHash.record || null,
  openRecord: (record) => {
    const { tab } = parseRecordHash(recordHash(record));
    if (typeof window !== 'undefined') window.location.hash = recordHash(record);
    set({ activeTab: tab as AppTab, focusRecord: record });
  },
  clearFocusRecord: () => set({ focusRecord: null }),
  isSidebarOpen: true,
  isCompactMode: false,
  isProMode: false,
  developerMode: (() => { try { return typeof localStorage !== 'undefined' && localStorage.getItem('lf_developer_mode') === 'true'; } catch { return false; } })(),
  isQuickEntryOpen: false,
  isHealthCheckOpen: false,
  isCommandPaletteOpen: false,
  isImporterOpen: false,
  isQBOMigrationOpen: false,
  isTemplateSelectorOpen: false,
  isAIBlueprintOpen: false,
  isCommandCenterOpen: false,
  isConverterOpen: false,
  isIntegrityOpen: false,
  isEntanglementOpen: false,
  isDiagnosticConsoleOpen: false,
  isGuideOpen: false,
  isArchitectureOpen: false,
  isFocusMode: false,
  isPrivacyMode: false,
  isShortcutOverlayOpen: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  isSyncing: false,
  language: 'en',
  filterCriteria: {
    startDate: `${new Date().getFullYear()}-01-01`,
    endDate: `${new Date().getFullYear()}-12-31`
  },
  parsingQueue: [],
  splittingTxId: null,
  isDevMode: false,
  theme: (() => {
    try {
      return (localStorage.getItem('lf_theme') as 'light' | 'dark' | 'system') || 'system';
    } catch {
      return 'system';
    }
  })(),
  isQuietMode: false,
  activeIntelChannel: 'radar',
  activeSettingsTab: 'billing',
  activeReportTab: 'pnl',
  lexiconOverrides: (() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('lf_lexicon_overrides') : null;
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  })(),
  hiddenTabs: storedHiddenTabs(typeof window !== 'undefined' ? localStorage.getItem('ledgerflow_current_workspace') : null),
  loadHiddenTabs: (workspaceId) => set({ hiddenTabs: storedHiddenTabs(workspaceId) }),
  pinnedPages: (() => {
    try { return parsePinned(typeof window !== 'undefined' ? localStorage.getItem('lf_pinned_pages') : null); } catch { return []; }
  })(),
  togglePinnedPage: (page) => set((state) => {
    const pinnedPages = togglePinned(state.pinnedPages, page);
    let reportPreferencesDeviceError = false;
    try { localStorage.setItem('lf_pinned_pages', JSON.stringify(pinnedPages)); } catch { reportPreferencesDeviceError = true; }
    return { pinnedPages, reportPreferencesDeviceError };
  }),
  recentReports: (() => {
    try { return parseRecentReports(typeof window !== 'undefined' ? localStorage.getItem(RECENT_REPORTS_KEY) : null); } catch { return []; }
  })(),
  recordRecentReport: (reportId) => set((state) => {
    if (normalizeRecentReports([reportId]).length === 0) return {};
    let stored: string[] = [];
    // Device-only mode keeps D-44's legacy initialization. Synced scopes are already hydrated and
    // must never resurrect another scope's legacy cache when their remote list is intentionally empty.
    if (state.reportPreferencesStatus === 'device' && state.recentReports.length === 0) {
      try { stored = parseRecentReports(localStorage.getItem(RECENT_REPORTS_KEY)); } catch { stored = []; }
    }
    const current = state.recentReports.length ? state.recentReports : stored;
    const recentReports = [reportId, ...current.filter(id => id !== reportId)].slice(0, MAX_RECENT_REPORTS);
    let reportPreferencesDeviceError = false;
    try { localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify(recentReports)); } catch { reportPreferencesDeviceError = true; }
    return { recentReports, reportPreferencesDeviceError };
  }),
  reportPreferencesStatus: 'device',
  reportPreferencesDeviceError: false,
  goToPage: (page) => {
    if (typeof window !== 'undefined' && window.location.hash !== `#${page.tab}`) window.location.hash = page.tab;
    set({
      activeTab: page.tab as AppTab,
      focusRecord: null,
      ...(page.tab === 'reports' && page.sub ? { activeReportTab: page.sub } : {}),
      ...(page.tab === 'settings' && page.sub ? { activeSettingsTab: page.sub } : {}),
    });
  },
  speedDials: (() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('lf_speed_dials') : null;
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  })(),

  // Preferences Defaults from LocalStorage
  fontSizeScale: (() => {
    try { return Number(localStorage.getItem('lf_font_size_scale')) || 100; } catch { return 100; }
  })(),
  fontSizePreset: (() => {
    return storedChoice('lf_font_size_preset', ['small', 'normal', 'medium', 'large', 'xlarge'] as const, 'normal');
  })(),
  fontFamily: (() => {
    return storedChoice('lf_font_family', ['system', 'inter', 'jakarta', 'serif', 'mono'] as const, 'system');
  })(),
  rowDensity: (() => {
    return storedChoice('lf_row_density', ['compact', 'normal', 'comfortable'] as const, 'normal');
  })(),
  accentColor: (() => {
    return storedChoice('lf_accent_color', ['emerald', 'indigo', 'amber', 'teal', 'violet', 'rose', 'slate'] as const, 'emerald');
  })(),
  highContrast: (() => {
    try { return localStorage.getItem('lf_high_contrast') === 'true'; } catch { return false; }
  })(),
  reduceMotion: (() => {
    try { return localStorage.getItem('lf_reduce_motion') === 'true'; } catch { return false; }
  })(),
  defaultLandingTab: (() => {
    try { return localStorage.getItem('lf_default_landing') || 'dashboard'; } catch { return 'dashboard'; }
  })(),
  dateFormatPref: (() => {
    // the same default as formatDate (src/lib/utils.ts)
    try { return localStorage.getItem('lf_date_format') || 'MMM DD, YYYY'; } catch { return 'MMM DD, YYYY'; }
  })(),
  numberDecimals: (() => {
    try {
      const val = localStorage.getItem('lf_number_decimals');
      return val !== null && val !== '' ? Number(val) : 2;
    } catch { return 2; }
  })(),

  // Preference Setters
  setFontSizeScale: (fontSizeScale) => {
    try { localStorage.setItem('lf_font_size_scale', String(fontSizeScale)); } catch { /* ignore storage error */ }
    set({ fontSizeScale });
  },
  setFontSizePreset: (fontSizePreset) => {
    try { localStorage.setItem('lf_font_size_preset', fontSizePreset); } catch { /* ignore storage error */ }
    let scale = 100;
    if (fontSizePreset === 'small') scale = 90;
    if (fontSizePreset === 'normal') scale = 100;
    if (fontSizePreset === 'medium') scale = 110;
    if (fontSizePreset === 'large') scale = 120;
    if (fontSizePreset === 'xlarge') scale = 130;
    try { localStorage.setItem('lf_font_size_scale', String(scale)); } catch { /* ignore storage error */ }
    set({ fontSizePreset, fontSizeScale: scale });
  },
  setFontFamily: (fontFamily) => {
    try { localStorage.setItem('lf_font_family', fontFamily); } catch { /* ignore storage error */ }
    set({ fontFamily });
  },
  setRowDensity: (rowDensity) => {
    try { localStorage.setItem('lf_row_density', rowDensity); } catch { /* ignore storage error */ }
    set({ rowDensity });
  },
  setAccentColor: (accentColor) => {
    try { localStorage.setItem('lf_accent_color', accentColor); } catch { /* ignore storage error */ }
    set({ accentColor });
  },
  setHighContrast: (highContrast) => {
    try { localStorage.setItem('lf_high_contrast', String(highContrast)); } catch { /* ignore storage error */ }
    set({ highContrast });
  },
  setReduceMotion: (reduceMotion) => {
    try { localStorage.setItem('lf_reduce_motion', String(reduceMotion)); } catch { /* ignore storage error */ }
    set({ reduceMotion });
  },
  setDefaultLandingTab: (defaultLandingTab) => {
    try { localStorage.setItem('lf_default_landing', defaultLandingTab); } catch { /* ignore storage error */ }
    set({ defaultLandingTab });
  },
  setDateFormatPref: (dateFormatPref) => {
    try { localStorage.setItem('lf_date_format', dateFormatPref); } catch { /* ignore storage error */ }
    setDateDisplayFormat(dateFormatPref);
    set({ dateFormatPref });
  },
  setNumberDecimals: (numberDecimals) => {
    try { localStorage.setItem('lf_number_decimals', String(numberDecimals)); } catch { /* ignore storage error */ }
    set({ numberDecimals });
  },

  setActiveIntelChannel: (activeIntelChannel) => set({ activeIntelChannel }),
  setActiveSettingsTab: (activeSettingsTab) => set({ activeSettingsTab }),
  setActiveReportTab: (activeReportTab) => set({ activeReportTab }),
  navigateTool: (id: string) => set((state) => {
    // Basic heuristics:
    const s = { ...state };
    
    // Check Intelligence & Lenses
    if (['radar', 'roi', 'signals', 'yield', 'burn', 'fx-exposure', 'growth-model', 'working-capital', 'pricing-optimizer', 'valuation'].includes(id)) {
      s.activeTab = 'intelligence' as AppTab;
      s.activeIntelChannel = id;
    }
    // Check Settings
    else if (['billing', 'rule', 'blueprint', 'developer', 'security', 'shortcuts'].includes(id)) {
      s.activeTab = 'settings' as AppTab;
      s.activeSettingsTab = id;
    }
    // Check Reports
    else if (['pnl', 'balance-sheet', 'cash-flow', 'trial-balance', 'general-ledger', 'tax', 'segment', 'compliance', 'financial-goals', 'ratios', 'profitability', 'forecast'].includes(id)) {
      s.activeTab = 'reports' as AppTab;
      s.activeReportTab = id;
    }
    // Default to main tab
    else {
      s.activeTab = id as AppTab;
    }
    
    if (typeof window !== 'undefined') {
      window.location.hash = s.activeTab;
    }
    
    return s;
  }),
  setActiveTab: (activeTab) => {
    if (typeof window !== 'undefined' && window.location.hash !== `#${activeTab}`) {
      window.location.hash = activeTab;
    }
    set({ activeTab, focusRecord: null });
  },
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  toggleQuietMode: () => set((state) => ({ isQuietMode: !state.isQuietMode })),
  toggleFocusMode: () => set((state) => ({ 
    isFocusMode: !state.isFocusMode,
    isSidebarOpen: state.isFocusMode // Open sidebar when leaving focus mode
  })),
  setCompactMode: (isCompactMode) => set({ isCompactMode }),
  setProMode: (isProMode) => set({ isProMode }),
  setDeveloperMode: (developerMode) => {
    try { localStorage.setItem('lf_developer_mode', developerMode ? 'true' : 'false'); } catch { /* private window: this session only */ }
    set({ developerMode });
  },
  setQuickEntryOpen: (isQuickEntryOpen) => set({ isQuickEntryOpen }),
  setHealthCheckOpen: (isHealthCheckOpen) => set({ isHealthCheckOpen }),
  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  setImporterOpen: (isImporterOpen) => set({ isImporterOpen }),
  setQBOMigrationOpen: (isQBOMigrationOpen: boolean) => set({ isQBOMigrationOpen }),
  setTemplateSelectorOpen: (isTemplateSelectorOpen) => set({ isTemplateSelectorOpen }),
  setAIBlueprintOpen: (isAIBlueprintOpen) => set({ isAIBlueprintOpen }),
  setCommandCenterOpen: (isCommandCenterOpen) => set({ isCommandCenterOpen }),
  setConverterOpen: (isConverterOpen) => set({ isConverterOpen }),
  setIntegrityOpen: (isIntegrityOpen) => set({ isIntegrityOpen }),
  setEntanglementOpen: (isEntanglementOpen) => set({ isEntanglementOpen }),
  setDiagnosticConsoleOpen: (isDiagnosticConsoleOpen) => set({ isDiagnosticConsoleOpen }),
  setGuideOpen: (isGuideOpen) => set({ isGuideOpen }),
  setArchitectureOpen: (isArchitectureOpen) => set({ isArchitectureOpen }),
  togglePrivacyMode: () => set((state) => ({ isPrivacyMode: !state.isPrivacyMode })),
  setShortcutOverlayOpen: (isShortcutOverlayOpen) => set({ isShortcutOverlayOpen }),
  setFilterCriteria: (filterCriteria) => set({ filterCriteria }),
  setIsOnline: (isOnline) => set({ isOnline }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  setParsingQueue: (parsingQueue) => set({ parsingQueue }),
  setSplittingTxId: (splittingTxId) => set({ splittingTxId }),
  addParsingItem: (item) => set((state) => ({ parsingQueue: [...state.parsingQueue, item] })),
  updateParsingItem: (id, updates) => set((state) => ({ 
    parsingQueue: state.parsingQueue.map(i => i.id === id ? { ...i, ...updates } : i) 
  })),
  setDevMode: (val) => set({ isDevMode: val }),
  setTheme: (theme) => {
    try {
      localStorage.setItem('lf_theme', theme);
    } catch {
      // Ignore storage error
    }
    set({ theme });
  },
  setLexiconOverride: (key, lang, value) => set((state) => {
    const existing = state.lexiconOverrides[key] || { en: '', he: '' };
    const nextOverrides = {
      ...state.lexiconOverrides,
      [key]: {
        ...existing,
        [lang]: value
      }
    };
    try {
      localStorage.setItem('lf_lexicon_overrides', JSON.stringify(nextOverrides));
    } catch {
      // Ignore storage error
    }
    return { lexiconOverrides: nextOverrides };
  }),
  resetLexiconOverrides: () => set(() => {
    try {
      localStorage.removeItem('lf_lexicon_overrides');
    } catch {
      // Ignore storage error
    }
    return { lexiconOverrides: {} };
  }),
  toggleTabVisibility: (id) => set((state) => {
    const isHidden = state.hiddenTabs.includes(id);
    const nextHidden = isHidden
      ? state.hiddenTabs.filter(x => x !== id)
      : [...state.hiddenTabs, id];
    try {
      const wsId = typeof window !== 'undefined' ? localStorage.getItem('ledgerflow_current_workspace') : null;
      const key = wsId ? `lf_hidden_tabs_${wsId}` : 'lf_hidden_tabs';
      localStorage.setItem(key, JSON.stringify(nextHidden));
    } catch {
      // Ignore storage error
    }
    return { hiddenTabs: nextHidden };
  }),
  setSpeedDial: (key, tabId) => set((state) => {
    const nextSpeedDials = { ...state.speedDials, [key]: tabId };
    try {
      localStorage.setItem('lf_speed_dials', JSON.stringify(nextSpeedDials));
    } catch {
      // Ignore storage error
    }
    return { speedDials: nextSpeedDials };
  }),
  removeSpeedDial: (key) => set((state) => {
    const { [key]: _, ...nextSpeedDials } = state.speedDials;
    try {
      localStorage.setItem('lf_speed_dials', JSON.stringify(nextSpeedDials));
    } catch {
      // Ignore storage error
    }
    return { speedDials: nextSpeedDials };
  })
}));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const { tab, record } = parseRecordHash(window.location.hash);
    const state = useUIStore.getState();
    if (tab && (state.activeTab !== tab || record)) {
      useUIStore.setState({ activeTab: tab as AppTab, focusRecord: record || null });
    }
  });

  window.addEventListener('online', () => {
    useUIStore.getState().setIsOnline(true);
  });
  window.addEventListener('offline', () => {
    useUIStore.getState().setIsOnline(false);
  });
}
