import { toast } from 'sonner';
import React, { useState, useId } from 'react';
import { 
  Type, 
  Sliders, 
  Sun, 
  Moon, 
  Monitor, 
  Palette, 
  Check, 
  Grid, 
  Calendar,
  Clock,
  Globe
} from 'lucide-react';
import { cn, DATE_DISPLAY_FORMATS, formatDate } from '../../../lib/utils';
import { TAX_ROUNDING, type TaxRounding } from '../../../lib/taxCodes';
import { useUIStore } from '../../../stores/useUIStore';
import { useAuthStore } from '../../../stores/useAuthStore';
import MoneyDisplayPanel from './MoneyDisplayPanel';
import InstallAppPanel from './InstallAppPanel';
import { db } from '../../../firebase';
import { doc, updateDoc } from '../../../lib/db/firestore';

export default function AppearanceSettings() {
  const settingsId = useId();
  const theme = useUIStore(state => state.theme);
  const setTheme = useUIStore(state => state.setTheme);
  const fontSizeScale = useUIStore(state => state.fontSizeScale);
  const fontSizePreset = useUIStore(state => state.fontSizePreset);
  const setFontSizeScale = useUIStore(state => state.setFontSizeScale);
  const setFontSizePreset = useUIStore(state => state.setFontSizePreset);
  const fontFamily = useUIStore(state => state.fontFamily);
  const setFontFamily = useUIStore(state => state.setFontFamily);
  const accentColor = useUIStore(state => state.accentColor);
  const setAccentColor = useUIStore(state => state.setAccentColor);
  const rowDensity = useUIStore(state => state.rowDensity);
  const setRowDensity = useUIStore(state => state.setRowDensity);
  const highContrast = useUIStore(state => state.highContrast);
  const setHighContrast = useUIStore(state => state.setHighContrast);
  const reduceMotion = useUIStore(state => state.reduceMotion);
  const setReduceMotion = useUIStore(state => state.setReduceMotion);
  const dateFormatPref = useUIStore(state => state.dateFormatPref);
  const setDateFormatPref = useUIStore(state => state.setDateFormatPref);
  useUIStore(state => state.numberDecimals);
  useUIStore(state => state.setNumberDecimals);

  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspaces = useAuthStore(state => state.workspaces);
  const setWorkspaces = useAuthStore(state => state.setWorkspaces);

  const activeWorkspace = workspaces.find(w => w.id === currentWorkspaceId);
  const currentTimezone = activeWorkspace?.timezone || 'UTC';
  const [isUpdatingZone, setIsUpdatingZone] = useState(false);

  const handleTimezoneChange = async (newZone: string) => {
    if (!currentWorkspaceId) return;
    setIsUpdatingZone(true);
    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        timezone: newZone
      });
      const updated = workspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, timezone: newZone };
        }
        return w;
      });
      setWorkspaces(updated);
    } catch (err) {
      console.error("[Settings] Failed to save workspace timezone:", err);
      toast.error('The time zone could not be saved (owners and accountants can change it).');
    } finally {
      setIsUpdatingZone(false);
    }
  };

  // Fiscal year start: reports' year and quarter pickers follow it
  const fiscalStartMonth = activeWorkspace?.fiscalYearStartMonth || 1;
  const handleFiscalStartChange = async (month: number) => {
    if (!currentWorkspaceId) return;
    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { fiscalYearStartMonth: month, fiscalYearStartDay: 1 });
      setWorkspaces(workspaces.map(w => (w.id === currentWorkspaceId ? { ...w, fiscalYearStartMonth: month, fiscalYearStartDay: 1 } : w)));
      toast.success('Fiscal year start saved');
    } catch (err) {
      console.error("[Settings] Failed to save fiscal year start:", err);
      toast.error('The fiscal year start could not be saved (owners and accountants can change it).');
    }
  };

  // Y-35: how tax on new and edited invoices and bills is rounded to cents
  const taxRounding: TaxRounding = activeWorkspace?.taxRounding || 'half_up';
  const handleTaxRoundingChange = async (mode: TaxRounding) => {
    if (!currentWorkspaceId) return;
    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { taxRounding: mode });
      setWorkspaces(workspaces.map(w => (w.id === currentWorkspaceId ? { ...w, taxRounding: mode } : w)));
      toast.success('Tax rounding saved');
    } catch (err) {
      console.error("[Settings] Failed to save tax rounding:", err);
      toast.error('Tax rounding could not be saved (owners and accountants can change it).');
    }
  };

  const fontPresets = [
    { id: 'small', label: 'Small', scale: 90, desc: 'Compact data view (90%)' },
    { id: 'normal', label: 'Normal', scale: 100, desc: 'Standard typography (100%)' },
    { id: 'medium', label: 'Medium', scale: 110, desc: 'Enhanced legibility (110%)' },
    { id: 'large', label: 'Large', scale: 120, desc: 'High visibility display (120%)' },
    { id: 'xlarge', label: 'Extra Large', scale: 130, desc: 'Maximum accessibility (130%)' }
  ];

  const fontFamilies = [
    { id: 'system', name: 'System Sans', style: 'font-sans', desc: 'Native OS font stack' },
    { id: 'inter', name: 'Inter UI', style: 'font-sans', desc: 'Precision geometric sans' },
    { id: 'jakarta', name: 'Plus Jakarta', style: 'font-sans', desc: 'Modern high-contrast display' },
    { id: 'serif', name: 'Playfair Serif', style: 'font-serif', desc: 'Classical editorial typography' },
    { id: 'mono', name: 'JetBrains Mono', style: 'font-mono', desc: 'Technical financial ledger code' }
  ];

  const accentPalettes = [
    { id: 'emerald', name: 'Emerald Brass', hex: '#D6A852', class: 'bg-[#D6A852]' },
    { id: 'indigo', name: 'Royal Sapphire', hex: '#6366F1', class: 'bg-[#6366F1]' },
    { id: 'amber', name: 'Amber Gold', hex: '#F59E0B', class: 'bg-[#F59E0B]' },
    { id: 'teal', name: 'Ocean Teal', hex: '#14B8A6', class: 'bg-[#14B8A6]' },
    { id: 'violet', name: 'Crystal Amethyst', hex: '#A855F7', class: 'bg-[#A855F7]' },
    { id: 'rose', name: 'Ruby Rose', hex: '#F43F5E', class: 'bg-[#F43F5E]' },
    { id: 'slate', name: 'Steel Slate', hex: '#94A3B8', class: 'bg-[#94A3B8]' }
  ];

  return (
    <div className="space-y-10">
      {/* Text Sizing & Font Scaling */}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-4 border-b border-[var(--line)] pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[var(--brass-soft)] border border-[var(--brass-line)] text-[var(--brass)] rounded-xl flex items-center justify-center">
              <Type aria-hidden="true" size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text)]">Text Sizing & Font Scale</h2>
              <p className="text-xs text-[var(--muted)]">Adjust text size dynamically across all views, tables, and dashboards.</p>
            </div>
          </div>
          <div className="px-3.5 py-1.5 bg-[var(--panel)] border border-[var(--line)] rounded-xl font-mono text-xs font-bold text-[var(--brass)]">
            Current Scale: {fontSizeScale}%
          </div>
        </div>

        {/* Preset Selector */}
        <div role="group" aria-labelledby={`${settingsId}-size-presets`} className="space-y-3">
          <span id={`${settingsId}-size-presets`} className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Size Presets</span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {fontPresets.map((preset) => (
              <button
                key={preset.id}
                aria-pressed={fontSizePreset === preset.id}
                onClick={() => setFontSizePreset(preset.id as unknown as "small" | "normal" | "medium" | "large" | "xlarge")}
                className={cn(
                  "p-3.5 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center gap-1",
                  fontSizePreset === preset.id
                    ? "bg-[var(--brass-soft)] border-[var(--brass)] text-[var(--text)] ring-1 ring-[var(--brass)] shadow-sm"
                    : "bg-[var(--panel)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--brass-line)]"
                )}
              >
                <span className="font-bold text-xs uppercase tracking-wider">{preset.label}</span>
                <span className="font-mono text-[10px] opacity-75">{preset.scale}%</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fine Slider */}
        <div className="space-y-3 p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl">
          <div className="flex items-center justify-between text-xs font-bold text-[var(--text)]">
            <label htmlFor={`${settingsId}-font-scale`} className="flex items-center gap-2">
              <Sliders aria-hidden="true" size={14} className="text-[var(--brass)]" />
              Fine-Grained Font Scale Slider
            </label>
            <span className="font-mono text-[var(--brass)]">{fontSizeScale}%</span>
          </div>
          <input
            id={`${settingsId}-font-scale`}
            type="range"
            min={80}
            max={150}
            step={5}
            value={fontSizeScale}
            onChange={(e) => setFontSizeScale(Number(e.target.value))}
            className="w-full accent-[var(--brass)] cursor-pointer h-2 bg-[var(--surface)] rounded-lg"
          />
          <div className="flex justify-between text-[10px] font-mono text-[var(--faint)]">
            <span>80% (Compact)</span>
            <span>100% (Standard)</span>
            <span>120% (Large)</span>
            <span>150% (Max)</span>
          </div>
        </div>

        {/* Live Typography Preview */}
        <div className="p-6 bg-[var(--ink)] border border-[var(--line)] rounded-xl space-y-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--brass)]">
            Live Typography Preview
          </span>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-[var(--text)]">
              General Ledger Account Summary - FY 2026
            </h3>
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              Operating cash flow generated $142,500.00 this month across all active accounts. All double-entry transactions meet double-entry balance constraints.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-[var(--faint)] pt-2 border-t border-[var(--line)]/50">
            <span>Code: 1010-CASH</span>
            <span>Debit: $14,250.00</span>
            <span className="text-[var(--pos)]">Status: Cleared</span>
          </div>
        </div>
      </div>

      {/* 3. Typography & Font Family */}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Typography & Font Family</h2>
          <p className="text-xs text-[var(--muted)] mt-1">Select the typeface family for the user interface.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {fontFamilies.map((font) => (
            <button
              key={font.id}
              aria-pressed={fontFamily === font.id}
              onClick={() => setFontFamily(font.id as unknown as "system" | "inter" | "jakarta" | "serif" | "mono")}
              className={cn(
                "p-5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 group",
                fontFamily === font.id
                  ? "bg-[var(--brass-soft)] border-[var(--brass)] ring-1 ring-[var(--brass)] shadow-sm"
                  : "bg-[var(--panel)] border-[var(--line)] hover:border-[var(--brass-line)]"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-[var(--text)]">{font.name}</span>
                {fontFamily === font.id && <Check aria-hidden="true" size={16} className="text-[var(--brass)]" />}
              </div>
              <p className={cn("text-base text-[var(--text)] font-semibold truncate", font.style)}>
                Sample $1,250.00
              </p>
              <span className="text-[10px] text-[var(--muted)]">{font.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 4. Color Palette & Theme Modes */}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-8">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Theme Mode & Color Accent</h2>
          <p className="text-xs text-[var(--muted)] mt-1">Choose your base theme mode and accent color highlight palette.</p>
        </div>

        {/* Theme Mode Buttons */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { id: 'light', name: 'Light Mode', icon: Sun },
            { id: 'dark', name: 'Dark Mode', icon: Moon },
            { id: 'system', name: 'System Auto', icon: Monitor }
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                aria-pressed={theme === item.id}
                onClick={() => setTheme(item.id as unknown as "light" | "dark" | "system")}
                className={cn(
                  "p-4 rounded-xl border flex flex-col items-center gap-2 transition-all cursor-pointer",
                  theme === item.id
                    ? "bg-[var(--brass-soft)] border-[var(--brass)] text-[var(--text)] ring-1 ring-[var(--brass)] shadow-sm"
                    : "bg-[var(--panel)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                )}
              >
                <Icon aria-hidden="true" size={20} className={theme === item.id ? "text-[var(--brass)]" : "text-[var(--muted)]"} />
                <span className="text-xs font-bold uppercase tracking-wider">{item.name}</span>
              </button>
            );
          })}
        </div>

        {/* Accent Color Palette Picker */}
        <div role="group" aria-labelledby={`${settingsId}-accent-palette`} className="space-y-3">
          <span id={`${settingsId}-accent-palette`} className="text-xs font-bold uppercase tracking-wider text-[var(--muted)] flex items-center gap-2">
            <Palette aria-hidden="true" size={14} className="text-[var(--brass)]" />
            Accent Palette
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
            {accentPalettes.map((palette) => (
              <button
                key={palette.id}
                aria-pressed={accentColor === palette.id}
                onClick={() => setAccentColor(palette.id as unknown as "emerald" | "indigo" | "amber" | "teal" | "violet" | "rose" | "slate")}
                className={cn(
                  "p-3 rounded-xl border flex flex-col items-center gap-2 transition-all cursor-pointer",
                  accentColor === palette.id
                    ? "bg-[var(--panel)] border-[var(--brass)] ring-1 ring-[var(--brass)] shadow-sm"
                    : "bg-[var(--panel)] border-[var(--line)] hover:border-[var(--brass-line)]"
                )}
              >
                <div className={cn("w-6 h-6 rounded-full shadow-inner border border-white/20", palette.class)} />
                <span className="text-[10px] font-bold text-[var(--text)] truncate">{palette.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 5. Layout Density & Formatting */}
      <div className="ledger-card p-8 md:p-10 bg-[var(--surface)] border border-[var(--line)] shadow-sm rounded-2xl space-y-8">
        <div>
          <h2 className="text-xl font-bold text-[var(--text)]">Layout Density & Regional Preferences</h2>
          <p className="text-xs text-[var(--muted)] mt-1">Configure row spacing, date formats, and contrast options.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Row Density */}
          <div role="group" aria-labelledby={`${settingsId}-row-density`} className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3">
            <span id={`${settingsId}-row-density`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
              <Grid aria-hidden="true" size={15} className="text-[var(--brass)]" />
              Table & Row Density
            </span>
            <div className="flex gap-2">
              {[
                { id: 'compact', label: 'Compact' },
                { id: 'normal', label: 'Normal' },
                { id: 'comfortable', label: 'Comfortable' }
              ].map((d) => (
                <button
                  key={d.id}
                  aria-pressed={rowDensity === d.id}
                  onClick={() => setRowDensity(d.id as unknown as "normal" | "compact" | "comfortable")}
                  className={cn(
                    "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer",
                    rowDensity === d.id
                      ? "bg-[var(--brass-soft)] border-[var(--brass)] text-[var(--text)]"
                      : "bg-[var(--surface)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <MoneyDisplayPanel />

          <InstallAppPanel />

          {/* Date Format */}
          <div role="group" aria-labelledby={`${settingsId}-date-format`} className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3">
            <span id={`${settingsId}-date-format`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
              <Calendar aria-hidden="true" size={15} className="text-[var(--brass)]" />
              Date Display Format
            </span>
            <div className="flex gap-2">
              {DATE_DISPLAY_FORMATS.map((fmt) => (
                <button
                  key={fmt}
                  aria-pressed={dateFormatPref === fmt}
                  onClick={() => setDateFormatPref(fmt)}
                  className={cn(
                    "flex-1 py-2 text-[11px] font-mono font-bold rounded-lg border transition-all cursor-pointer",
                    dateFormatPref === fmt
                      ? "bg-[var(--brass-soft)] border-[var(--brass)] text-[var(--text)]"
                      : "bg-[var(--surface)] border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]"
                  )}
                >
                  {formatDate('2026-10-02', fmt)}
                </button>
              ))}
            </div>
          </div>

          {/* Workspace Timezone */}
          <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
            <label htmlFor={`${settingsId}-timezone`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
              <Clock aria-hidden="true" size={15} className="text-[var(--brass)]" />
              Workspace Timezone
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <select
                id={`${settingsId}-timezone`}
                value={currentTimezone}
                onChange={(e) => handleTimezoneChange(e.target.value)}
                disabled={isUpdatingZone}
                className="flex-1 bg-[var(--surface)] text-[var(--text)] text-sm font-medium p-2.5 rounded-lg border border-[var(--line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
              >
                <option value="UTC">UTC (Coordinated Universal Time)</option>
                <option value="America/New_York">America/New_York (Eastern Time)</option>
                <option value="America/Chicago">America/Chicago (Central Time)</option>
                <option value="America/Denver">America/Denver (Mountain Time)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (Pacific Time)</option>
                <option value="Europe/London">Europe/London (Greenwich Mean Time / BST)</option>
                <option value="Europe/Paris">Europe/Paris (Central European Time)</option>
                <option value="Asia/Jerusalem">Asia/Jerusalem (Israel Standard Time)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (Japan Standard Time)</option>
                <option value="Australia/Sydney">Australia/Sydney (Australian Eastern Time)</option>
              </select>
              <div className="flex items-center gap-2 text-xs text-[var(--muted)] px-3 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-lg">
                <Globe aria-hidden="true" size={14} className="text-[var(--brass)]" />
                <span>Active: <strong>{currentTimezone}</strong></span>
              </div>
            </div>
            <p className="text-[10px] text-[var(--muted)]">Lock the general ledger transaction entry timestamps, lock periods, and reports specifically to your entity's operational timezone.</p>
          </div>

          {/* Fiscal year start */}
          <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
            <label htmlFor={`${settingsId}-fiscal-start`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
              <Clock aria-hidden="true" size={15} className="text-[var(--brass)]" />
              Fiscal year starts in
            </label>
            <select
              id={`${settingsId}-fiscal-start`}
              value={fiscalStartMonth}
              onChange={(e) => handleFiscalStartChange(Number(e.target.value))}
              className="w-full sm:w-64 bg-[var(--surface)] text-[var(--text)] text-sm font-medium p-2.5 rounded-lg border border-[var(--line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
            >
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--muted)]">Reports use it for the year and quarter pickers (a fiscal year is named after the calendar year it ends in).</p>
          </div>

          {/* Tax rounding (Y-35) */}
          <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl space-y-3 md:col-span-2">
            <label htmlFor={`${settingsId}-tax-rounding`} className="text-xs font-bold uppercase tracking-wider text-[var(--text)] flex items-center gap-2">
              Tax rounding
            </label>
            <select
              id={`${settingsId}-tax-rounding`}
              value={taxRounding}
              onChange={(e) => handleTaxRoundingChange(e.target.value as TaxRounding)}
              className="w-full sm:w-64 bg-[var(--surface)] text-[var(--text)] text-sm font-medium p-2.5 rounded-lg border border-[var(--line)] focus:outline-none focus:ring-1 focus:ring-[var(--brass)] cursor-pointer"
            >
              {(Object.keys(TAX_ROUNDING) as TaxRounding[]).map(mode => (
                <option key={mode} value={mode}>{TAX_ROUNDING[mode]}</option>
              ))}
            </select>
            <p className="text-[10px] text-[var(--muted)]">How the tax on an invoice or bill is rounded to the cent when it is created or edited. Documents already saved keep their tax.</p>
          </div>

          {/* High Contrast Toggle */}
          <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">High Contrast Mode</h3>
              <p className="text-[10px] text-[var(--muted)] mt-0.5">Increases text contrast and border legibility.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={highContrast}
              aria-label="High contrast"
              onClick={() => setHighContrast(!highContrast)}
              className={cn(
                "w-12 h-6 rounded-full transition-colors relative cursor-pointer p-0.5",
                highContrast ? "bg-[var(--brass)]" : "bg-[var(--surface)] border border-[var(--line)]"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-black transition-transform",
                highContrast ? "translate-x-6" : "translate-x-0"
              )} />
            </button>
          </div>

          {/* Reduced Motion Toggle */}
          <div className="p-5 bg-[var(--panel)] border border-[var(--line)] rounded-xl flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-[var(--text)] uppercase tracking-wider">Reduced Motion</h3>
              <p className="text-[10px] text-[var(--muted)] mt-0.5">Minimizes page transitions and animations.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reduceMotion}
              aria-label="Reduce motion"
              onClick={() => setReduceMotion(!reduceMotion)}
              className={cn(
                "w-12 h-6 rounded-full transition-colors relative cursor-pointer p-0.5",
                reduceMotion ? "bg-[var(--brass)]" : "bg-[var(--surface)] border border-[var(--line)]"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-full bg-black transition-transform",
                reduceMotion ? "translate-x-6" : "translate-x-0"
              )} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
