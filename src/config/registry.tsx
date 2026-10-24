/*
 * REGISTRY MAP - HOW TO MODIFY:
 * ---------------------------------
 * - VIEW_COMPONENTS: Register new main components here (lazy loaded).
 * - APP_TABS: Register left sidebar navigation tabs.
 * - NAV_GROUPS: Categorize sidebar tabs into dropdowns.
 * - SYSTEM_COMMANDS: Add new commands for the CMD+K palette.
 * - DASHBOARD_KPI_REGISTRY: Add new top-level dashboard metrics.
 * - ANALYTICAL_LENSES_REGISTRY: Add tools for the Intelligence Center.
 * - *_TABS_REGISTRY: Inner navigation tabs for specific views (Reports, Settings, etc).
 */

import { lazy } from 'react';
import { withScreenHelp } from './screenHelp';
import type { ComponentType, ElementType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  FileArchive, CalendarClock,
  BarChart3, Activity, FileText, Database, Layers, 
  ArrowDownRight, ArrowUpRight, Users, RefreshCw, 
  ShieldCheck, Terminal as TerminalIcon, Settings, Building, Cpu as CpuIcon,
  Target, Briefcase, Sparkles, 
  TrendingUp, TrendingDown, DollarSign, Calendar, Sliders, SlidersHorizontal,
  Home, CreditCard, Clock, FileSignature, Zap, ShoppingCart, Headphones, Search, Package, CalendarDays, Globe, Truck, Handshake, ClipboardCheck, GitMerge, Scale, Barcode, RotateCcw, Coins, Wallet, Filter, MailWarning, Blocks, PackageCheck, ArrowLeftRight
, Receipt, Tag , PieChart, Inbox, BookOpen, FileSpreadsheet, Upload, Mail, Palette, Hash, MessageCircleQuestion, BellRing, FolderTree, MessageSquareText, Split, BadgePercent, UserCheck, ListChecks, MapPin } from 'lucide-react';
import { getEntityRegistry, defineEntity } from '../lib/entityFramework';

// Plugin Discovery Engine (Upgraded to dynamic code-splitting and bundle optimization - Point 5)
// Vite replaces the call at build time; outside Vite (unit tests) there are simply no plugins.
let pluginModules: Record<string, () => Promise<{ default: ComponentType }>> = {};
try { pluginModules = import.meta.glob<{ default: ComponentType }>('../plugins/*.tsx'); } catch { /* not running under Vite */ }
const dynamicTabs: AppTabDefinition[] = [];
const dynamicComponents: Record<string, ElementType> = {};
for (const path in pluginModules) {
  const fileName = path.split('/').pop()?.replace('.tsx', '') || '';
  if (fileName && fileName !== 'README' && fileName !== 'README.md') {
    const formattedName = fileName.replace(/([A-Z])/g, ' $1').trim();
    
    // Wrap component lazily using React.lazy code-splitting
    dynamicComponents[fileName] = lazy(() => {
      return pluginModules[path]().then((mod) => {
        return { default: mod.default };
      });
    });

    dynamicTabs.push({
      id: fileName,
      label: { en: formattedName, he: formattedName },
      icon: Layers,
      groupId: 'plugins',
      help: 'This screen provides an installed extension. Use its controls for the workflow described by the extension. Its data sources and actions depend on the installed plugin; review its own documentation before making changes.'
    });
  }
}

// 1. Definition of all View Components
export const VIEW_COMPONENTS: Record<string, ElementType> = {
  'inventory': lazy(() => import('../components/inventory/Inventory')),
  'practice': lazy(() => import('../components/dashboard/PracticeView')),
  'accept-invite': lazy(() => import('../components/auth/AcceptInviteView')),
  ...dynamicComponents,
  'dashboard': lazy(() => import('../components/Dashboard')),
  'architecture': lazy(() => import('../components/system/ArchitectureViewer')),
  'intelligence': lazy(() => import('../components/intelligence/IntelligenceCenter')),
  'copilot': lazy(() => import('../components/intelligence/Copilot')),
  'audit': lazy(() => import('../components/forensics/ForensicAudit')),
  'transactions': lazy(() => import('../components/ledger/TransactionGrid')),
  'register': lazy(() => import('../components/finance/AccountRegisterView')),
  'general-ledger': lazy(() => import('../components/ledger/GeneralLedgerView')),
  'statement': lazy(() => import('../components/reporting/StatementView')),
  'payments': lazy(() => import('../components/finance/PaymentsView')),
  'tax-liability': lazy(() => import('../components/reporting/TaxLiabilityView')),
  'estimates': lazy(() => import('../components/sales/EstimatesView')),
  'projects': lazy(() => import('../components/projects/Projects')),
  'reports': lazy(() => import('../components/reporting/Reports')),
  'ledger': lazy(() => import('../components/ledger/TwoLensesLedger')),
  'sales': lazy(() => import('../components/sales/Sales')),
  'purchases': lazy(() => import('../components/purchases/Purchases')),
  'purchase-orders': lazy(() => import('../components/purchases/PurchaseOrdersView')),
  'loans': lazy(() => import('../components/finance/LoansView')),
  'petty-cash': lazy(() => import('../components/finance/PettyCashView')),
  'payroll': lazy(() => import('../components/hr/PayrollView')),
  'assets': lazy(() => import('../components/assets/FixedAssetsView')),
  'settings': lazy(() => import('../components/platform/Settings')),
  'api-hub': lazy(() => import('../components/platform/ApiHub')),
  'reconciliation': lazy(() => import('../components/ledger/Reconciliation')),
  'banking': lazy(() => import('../components/banking/Banking')),
  'forecaster': lazy(() => import('../components/planning/CashFlowPredictor')),
  'budgets': lazy(() => import('../components/planning/BudgetManager')),
  'time-machine': lazy(() => import('../components/ledger/TimeMachine')),
  'inbox': lazy(() => import('../components/ledger/InboxView')),
  'month-end-close': lazy(() => import('../components/ledger/MonthEndCloseView')),
  'fiscal-periods': lazy(() => import('../components/finance/FiscalPeriodManager')),
  'ask': lazy(() => import('../components/ledger/AskLoop')),
  'magic': lazy(() => import('../components/ledger/MagicEntry')),
  'vault': lazy(() => import('../components/forensics/Vault')),
      'audit-trail': lazy(() => import('../components/forensics/AuditTrail')),
  'client-queries': lazy(() => import('../components/ledger/ClientQueriesView')),
  'accountant-queue': lazy(() => import('../components/ledger/AccountantQueueView')),
  'tasks': lazy(() => import('../components/collaboration/TasksView')),
  'time': lazy(() => import('../components/collaboration/TimeView')),
  'recurring': lazy(() => import('../components/ledger/RecurringTransactionsView')),
  'system-command-center': lazy(() => import('../components/platform/SystemCommandCenter')),
  'consolidation': lazy(() => import('../components/finance/Consolidation')),
  'credit-notes': lazy(() => import('../components/finance/CreditNotesView')),
  'intercompany': lazy(() => import('../components/finance/IntercompanyManager')),
  'taxes': lazy(() => import('../components/finance/TaxManager')),
  'support': lazy(() => import('../components/support/SupportView')),
  'help': lazy(() => import('../components/support/HelpGuideView')),
  'data-health': lazy(() => import('../components/system/DataHealthView')),
  'charts': lazy(() => import('../components/finance/FinancialChartsDashboard')),
  'query-builder': lazy(() => import('../components/ledger/QueryView')),
  'pricing': lazy(() => import('../components/commercial/PricingPage').then(m => ({ default: m.PricingPage }))),
};

export interface AppTabDefinition {
  help: string;
  /** A-201: the same description in Hebrew, attached by `withScreenHelp()` */
  helpHe?: string;
  id: string;
  label: Record<string, string>;
  icon: LucideIcon;
  groupId?: string;
  requiresOwner?: boolean;
  isAdvanced?: boolean;
  /** Demo screen on made-up data: only with the developer switch on (FOR_YOU 11). */
  developerOnly?: boolean;
}

export { isTabVisible } from './tabVisibility';

export const APP_TABS: AppTabDefinition[] = withScreenHelp<Omit<AppTabDefinition, 'help'>>([
  { id: 'dashboard', label: { en: 'Overview', he: 'סקירה' }, icon: Home, groupId: 'dashboard' },
  { id: 'inbox', label: { en: 'To Review', he: 'לסקירה' }, icon: Inbox, groupId: 'dashboard' },
  { id: 'practice', label: { en: 'All my books', he: 'כל הספרים שלי' }, icon: Briefcase, groupId: 'dashboard' },
  { id: 'copilot', label: { en: 'AI Co-pilot', he: 'טייס משנה' }, icon: Sparkles, groupId: 'dashboard' },

  { id: 'transactions', label: { en: 'Transactions', he: 'תנועות' }, icon: Layers, groupId: 'transactions' },
  { id: 'credit-notes', label: { en: 'Credit Notes & Vendor Credits', he: 'זיכויים וזיכויי ספק' }, icon: RotateCcw, groupId: 'transactions' },
  { id: 'assets', label: { en: 'Fixed Asset Register', he: 'רכוש קבוע' }, icon: Building, groupId: 'transactions' },
  { id: 'register', label: { en: 'Account Register', he: 'יומן חשבון' }, icon: BookOpen, groupId: 'transactions' },
  { id: 'ledger', label: { en: 'Ledger & Journal', he: 'ספר ראשי ויומן' }, icon: Database, groupId: 'transactions' },
  { id: 'intercompany', label: { en: 'Intercompany', he: 'בין-חברתי' }, icon: ArrowLeftRight, groupId: 'transactions' },
  { id: 'recurring', label: { en: 'Recurring Items', he: 'פריטים מחזוריים' }, icon: RefreshCw, groupId: 'transactions' },
  { id: 'query-builder', label: { en: 'BQL Query Builder', he: 'בונה שאילתות' }, icon: Filter, groupId: 'transactions' },
  { id: 'banking', label: { en: 'Bank Connections', he: 'חיבורי בנק' }, icon: Building, groupId: 'transactions' },
  { id: 'audit-trail', label: { en: 'Audit Trail', he: 'יומן ביקורת' }, icon: Search, groupId: 'transactions' },
  { id: 'client-queries', label: { en: 'Questions about Entries', he: 'שאלות על תנועות' }, icon: MessageCircleQuestion, groupId: 'transactions' },
  { id: 'tasks', label: { en: 'Tasks', he: 'משימות' }, icon: ListChecks, groupId: 'transactions' },

  { id: 'reconciliation', label: { en: 'Reconcile', he: 'התאמות' }, icon: RefreshCw, groupId: 'reconcile' },
  { id: 'month-end-close', label: { en: 'Month-End Close', he: 'סגירת חודש' }, icon: ClipboardCheck, groupId: 'reconcile' },
  { id: 'fiscal-periods', label: { en: 'Fiscal Periods', he: 'תקופות פיסקליות' }, icon: CalendarDays, groupId: 'reconcile' },

  { id: 'sales', label: { en: 'Sales', he: 'כסף נכנס' }, icon: ArrowUpRight, groupId: 'money_in' },
  { id: 'estimates', label: { en: 'Estimates & Quotes', he: 'הצעות מחיר' }, icon: FileSignature, groupId: 'money_in' },
  { id: 'payments', label: { en: 'Payments', he: 'תשלומים' }, icon: DollarSign, groupId: 'money_in' },
  { id: 'time', label: { en: 'Time', he: 'שעות עבודה' }, icon: Clock, groupId: 'money_in' },
  
  { id: 'purchases', label: { en: 'Purchases', he: 'כסף יוצא' }, icon: ArrowDownRight, groupId: 'money_out' },
  { id: 'purchase-orders', label: { en: 'Purchase Orders', he: 'הזמנות רכש' }, icon: ShoppingCart, groupId: 'money_out' },
  // BB-07: in the menu when their module is on (Settings → Modules)
  { id: 'inventory', label: { en: 'Inventory', he: 'מלאי' }, icon: Package, groupId: 'money_out' },
  { id: 'loans', label: { en: 'Loans', he: 'הלוואות' }, icon: Coins, groupId: 'money_out' },
  { id: 'petty-cash', label: { en: 'Petty Cash', he: 'קופה קטנה' }, icon: Wallet, groupId: 'money_out' },
  { id: 'payroll', label: { en: 'Payroll & Wages', he: 'שכר עובדים' }, icon: Users, groupId: 'money_out' },

  { id: 'reports', label: { en: 'Reports', he: 'דוחות' }, icon: FileText, groupId: 'reports' },
  { id: 'charts', label: { en: 'Visual Analytics', he: 'ניתוח חזותי' }, icon: PieChart, groupId: 'reports' },
  { id: 'forecaster', label: { en: 'Forecasting', he: 'תחזית תזרים' }, icon: TrendingUp, groupId: 'reports' },
  { id: 'budgets', label: { en: 'Budgets', he: 'תקציבים' }, icon: Target, groupId: 'reports' },
  { id: 'projects', label: { en: 'Projects', he: 'פרויקטים' }, icon: Briefcase, groupId: 'reports' },
  { id: 'intelligence', label: { en: 'Insights', he: 'תובנות' }, icon: BarChart3, groupId: 'reports' },

  { id: 'settings', label: { en: 'Preferences', he: 'הגדרות' }, icon: Settings, groupId: 'settings' },
  { id: 'data-health', label: { en: 'Data Health & Audit', he: 'בריאות נתונים' }, icon: ShieldCheck, groupId: 'settings' },
  { id: 'support', label: { en: 'Support', he: 'תמיכה' }, icon: Headphones, groupId: 'settings' },
  { id: 'help', label: { en: 'Help & Guide', he: 'מדריך ועזרה' }, icon: BookOpen, groupId: 'settings' },
  { id: 'vault', label: { en: 'Documents', he: 'מסמכים' }, icon: ShieldCheck, groupId: 'settings' },
  { id: 'pricing', label: { en: 'Pricing & Plans', he: 'תמחור ומסלולים' }, icon: Zap, groupId: 'settings' },
  { id: 'api-hub', label: { en: 'API Platform', he: 'ממשק API' }, icon: TerminalIcon, groupId: 'settings' },
  { id: 'system-command-center', label: { en: 'Admin Panel', he: 'ניהול' }, icon: Building, groupId: 'settings', requiresOwner: true, developerOnly: true }
], 'main');

export const NAV_GROUPS: Record<string, Record<string, string>> = {
  dashboard: { en: 'Dashboard', he: 'לוח בקרה' },
  transactions: { en: 'Transactions', he: 'תנועות' },
  reconcile: { en: 'Reconcile', he: 'התאמות' },
  money_in: { en: 'Money In', he: 'כסף נכנס' },
  money_out: { en: 'Money Out', he: 'כסף יוצא' },
  reports: { en: 'Reports', he: 'דוחות' },
  settings: { en: 'Settings', he: 'הגדרות' }
};

export const getVisibleTabs = (lang: string, isOwner: boolean, hiddenTabs?: string[]) => {
  const groups: Record<string, { id: string; label: string; icon: LucideIcon }[]> = Object.keys(NAV_GROUPS).reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {} as Record<string, { id: string; label: string; icon: LucideIcon }[]>);

  const dynamicGroups: Record<string, { id: string; label: string; icon: LucideIcon }[]> = {};

  APP_TABS.forEach(tab => {
    if (tab.requiresOwner && !isOwner) return;
    if (hiddenTabs && hiddenTabs.includes(tab.id)) return;
    if (tab.groupId === 'hidden') return;
    
    if (groups[tab.groupId || '']) {
      groups[tab.groupId || ''].push({
        id: tab.id,
        label: tab.label[lang] || tab.label['en'],
        icon: tab.icon
      });
    } else {
      if (!dynamicGroups[tab.groupId || '']) dynamicGroups[tab.groupId || ''] = [];
      dynamicGroups[tab.groupId || ''].push({
        id: tab.id,
        label: tab.label[lang] || tab.label['en'],
        icon: tab.icon
      });
    }
  });

  return Object.keys(groups)
    .filter(groupId => groups[groupId].length > 0)
    .map(groupId => ({
      id: groupId,
      label: NAV_GROUPS[groupId] ? (NAV_GROUPS[groupId][lang] || NAV_GROUPS[groupId]['en']) : groupId,
      items: groups[groupId]
    }))
    .concat(
      Object.keys(dynamicGroups).map(groupId => ({
        id: groupId,
        label: groupId,
        items: dynamicGroups[groupId]
      }))
    );
};

export const SYSTEM_GLOSSARY: Record<string, Record<string, string>> = {
  'dashboard.welcome.title': { en: 'Welcome to the System', he: 'ברוכים הבאים למערכת' },
  'dashboard.welcome.subtitle': { en: 'Complete these steps to get your ERP fully operational.', he: 'השלם את השלבים האלה כדי להפעיל את המערכת.' },
  'dashboard.onboarding.step1.title': { en: 'Create Workspace', he: 'צור סביבת עבודה' },
  'dashboard.onboarding.step1.desc': { en: 'Set up your business profile and preferences.', he: 'הגדר את פרופיל העסק שלך והעדפותיך.' },
  'dashboard.onboarding.step2.title': { en: 'Add Bank Accounts', he: 'הוסף חשבונות בנק' },
  'dashboard.onboarding.step2.desc': { en: 'Connect or create asset accounts to track cash flow.', he: 'התחבר או צור חשבונות נכסים.' },
  'dashboard.onboarding.step3.title': { en: 'Create First Invoice', he: 'צור חשבונית ראשונה' },
  'dashboard.onboarding.step3.desc': { en: 'Get paid by your customers and record sales.', he: 'קבל תשלום מהלקוחות שלך ורשום מכירות.' },
  appName: { en: 'LedgerFlow', he: 'לדג׳רפלואו' },
  overview: { en: 'Overview', he: 'סקירה' },
  transactions: { en: 'Transactions', he: 'תנועות' },
  generalLedger: { en: 'General Ledger', he: 'ספר ראשי' },
  trialBalance: { en: 'Trial Balance', he: 'מאזן בוחן' },
  profitAndLoss: { en: 'Profit & Loss', he: 'רווח והפסד' },
  balanceSheet: { en: 'Balance Sheet', he: 'מאזן' },
  reconciliation: { en: 'Reconciliation', he: 'התאמות' },
  settings: { en: 'Settings', he: 'הגדרות' },
  budget: { en: 'Budgets', he: 'תקציבים' },
  secureAuthentication: { en: 'Secure Authentication', he: 'אימות מאובטח' },
  loginWithGoogle: { en: 'Login with Google', he: 'התחברות באמצעות Google' },
  connectingSecureVault: { en: 'Connecting to Secure Vault', he: 'מתחבר לכספת מאובטחת' },
  professionalFinancialManagement: { en: 'Professional financial management for modern business. Smart auditing and reporting.', he: 'ניהול פיננסי מקצועי לעסקים מודרניים. ניהול ביקורת כספיים חכם.' }
};

export interface CommandDefinition {
  id: string;
  label: { en: string; he: string };
  category: string;
  actionId: string;
  payload?: Record<string, unknown>;
}

export const SYSTEM_COMMANDS: CommandDefinition[] = [
  { id: 'export-data', label: { en: 'Export workspace data', he: 'ייצוא נתוני סביבת העבודה' }, category: 'Data', actionId: 'export' },
  { id: 'reconcile', label: { en: 'Smart Matching', he: 'התאמות חכמות' }, category: 'Operations', actionId: 'start-reconciliation' },
  { id: 'generate-report', label: { en: 'Financial Reports', he: 'דוחות כספיים' }, category: 'Insights', actionId: 'reports' },
  { id: 'calibrate', label: { en: 'Currency Converter', he: 'המרת מטבעות' }, category: 'System', actionId: 'open-converter' },
  { id: 'quick-entry', label: { en: 'Add New Entry', he: 'הוספת תנועה חדשה' }, category: 'Operations', actionId: 'quick-entry' },
  { id: 'switch-tab-ledger', label: { en: 'Go to General Ledger', he: 'מעבר לספר ראשי' }, category: 'Navigation', actionId: 'switch-tab', payload: { tab: 'ledger' } },
  { id: 'switch-tab-reports', label: { en: 'Go to Financial Reports', he: 'מעבר לדוחות' }, category: 'Navigation', actionId: 'switch-tab', payload: { tab: 'reports' } },
  { id: 'health-check', label: { en: 'Ledger Health Check', he: 'בדיקת בריאות' }, category: 'System', actionId: 'open-health-check' },
  { id: 'fiscal-periods', label: { en: 'Manage Fiscal Periods', he: 'ניהול תקופות פיסקליות' }, category: 'System', actionId: 'switch-tab', payload: { tab: 'fiscal-periods' } },
  { id: 'run-audit', label: { en: 'Ledger Integrity Auditor', he: 'ביקורת תקינות ספר ראשי' }, category: 'System', actionId: 'open-integrity' },
  { id: 'system-center', label: { en: 'Admin Panel', he: 'פתיחת מרכז ניהול מערכת' }, category: 'System', actionId: 'open-command-center' },
  { id: 'settings-currency', label: { en: 'Change Currency (Settings)', he: 'שינוי מטבע (הגדרות)' }, category: 'Settings', actionId: 'switch-tab', payload: { tab: 'settings', subTab: 'localization' } },
  { id: 'settings-taxes', label: { en: 'Tax Settings', he: 'הגדרות מס' }, category: 'Settings', actionId: 'switch-tab', payload: { tab: 'settings', subTab: 'taxes' } },
  { id: 'settings-team', label: { en: 'Team & Roles', he: 'צוות והרשאות' }, category: 'Settings', actionId: 'switch-tab', payload: { tab: 'settings', subTab: 'team' } },
  { id: 'settings-profile', label: { en: 'User Profile', he: 'פרופיל משתמש' }, category: 'Settings', actionId: 'switch-tab', payload: { tab: 'settings', subTab: 'profile' } },
  { id: 'keyboard-shortcuts', label: { en: 'Keyboard shortcuts (?)', he: 'קיצורי מקלדת (?)' }, category: 'Help', actionId: 'open-shortcuts' }
];

interface DashboardKpiStats {
  revenue: string; revenueTrend: number;
  expenses: string; expensesTrend: number;
  netCash: string; netCashTrend: number;
  runway: number;
}

export interface DashboardKpiDefinition {
  id: string;
  title: Record<string, string>;
  icon: LucideIcon;
  color: 'emerald' | 'rose' | 'azure' | 'amber';
  actionId: string;
  actionPayload?: Record<string, unknown>;
  valueExtractor: (stats: DashboardKpiStats) => string;
  trendExtractor: (stats: DashboardKpiStats) => number;
}

export const DASHBOARD_KPI_REGISTRY: DashboardKpiDefinition[] = [
  {
    id: 'revenue',
    title: { en: 'Total Revenue', he: 'סך הכנסות' },
    icon: TrendingUp,
    color: 'emerald',
    actionId: 'drill-down',
    actionPayload: { type: 'income' },
    valueExtractor: (stats) => stats.revenue,
    trendExtractor: (stats) => stats.revenueTrend
  },
  {
    id: 'expenses',
    title: { en: 'Total Expenses', he: 'סך הוצאות' },
    icon: TrendingDown,
    color: 'rose',
    actionId: 'drill-down',
    actionPayload: { type: 'expense' },
    valueExtractor: (stats) => stats.expenses,
    trendExtractor: (stats) => stats.expensesTrend
  },
  {
    id: 'netCash',
    title: { en: 'Net Cash Flow', he: 'תזרים מזומנים נטו' },
    icon: DollarSign,
    color: 'azure',
    actionId: 'drill-down',
    valueExtractor: (stats) => stats.netCash,
    trendExtractor: (stats) => stats.netCashTrend
  },
  {
    id: 'runway',
    title: { en: 'Current Runway', he: 'תחזית נזילות' },
    icon: Calendar,
    color: 'amber',
    actionId: 'switch-tab',
    actionPayload: { tab: 'forecaster' },
    valueExtractor: (stats) => stats.runway + ' Mo',
    trendExtractor: () => 0
  }
];

export const REPORT_COMPONENTS: Record<string, ElementType> = {
  'CustomerCohortsReportView': lazy(() => import('../components/reporting/CustomerCohortsReportView')),
  'AssetRegisterReportView': lazy(() => import('../components/reporting/AssetRegisterReportView')),
  'OneSidedTransfersReportView': lazy(() => import('../components/reporting/OneSidedTransfersReportView')),
  'BudgetActualReportView': lazy(() => import('../components/reporting/BudgetActualReportView')),
  'PNLView': lazy(() => import('../components/ledger/ProfitAndLossView')),
  'BalanceSheetReportView': lazy(() => import('../components/ledger/BalanceSheetView')),
  'GroupSummaryReportView': lazy(() => import('../components/reporting/GroupSummaryReportView')),
  'AskBooksView': lazy(() => import('../components/reporting/AskBooksView')),
  'LabelProfitReportView': lazy(() => import('../components/reporting/LabelProfitReportView')),
  'LabelBalanceSheetReportView': lazy(() => import('../components/reporting/LabelBalanceSheetReportView')),
  'GoodsNotBilledReportView': lazy(() => import('../components/reporting/GoodsNotBilledReportView')),
  'CommissionReportView': lazy(() => import('../components/reporting/CommissionReportView')),
  'BackordersReportView': lazy(() => import('../components/reporting/BackordersReportView')),
  'Form856ReportView': lazy(() => import('../components/reporting/Form856ReportView')),
  'StockAgingReportView': lazy(() => import('../components/reporting/StockAgingReportView')),
  'SlowMovingStockView': lazy(() => import('../components/reporting/SlowMovingStockView')),
  'ProfitabilityByView': lazy(() => import('../components/reporting/ProfitabilityByView')),
  'ItemRegisterReportView': lazy(() => import('../components/reporting/ItemRegisterReportView')),
  'DepreciationLedgerReportView': lazy(() => import('../components/reporting/DepreciationLedgerReportView')),
  'BankClearanceReportView': lazy(() => import('../components/reporting/BankClearanceReportView')),
  'InventoryDetailsReportView': lazy(() => import('../components/reporting/InventoryDetailsReportView')),
  'StockSourcesUsesReportView': lazy(() => import('../components/reporting/StockSourcesUsesReportView')),
  'CashFlowView': lazy(() => import('../components/ledger/CashFlowView')),
  'ARAgingReportView': lazy(() => import('../components/reporting/ARAgingReportView')),
  'APAgingReportView': lazy(() => import('../components/reporting/APAgingReportView')),
  'GeneralLedgerView': lazy(() => import('../components/ledger/GeneralLedgerView')),
  'StatementView': lazy(() => import('../components/reporting/StatementView')),
  'TaxLiabilityView': lazy(() => import('../components/reporting/TaxLiabilityView')),
  'AccountantExportPackView': lazy(() => import('../components/reporting/AccountantExportPackView')),
  'ExpenseByCategoryReportView': lazy(() => import('../components/reporting/ExpenseByCategoryReportView')),
  'IncomeBySourceReportView': lazy(() => import('../components/reporting/IncomeBySourceReportView')),
  'TopExpensesIncomeReportView': lazy(() => import('../components/reporting/TopExpensesIncomeReportView')),
  'AverageMonthlyReportView': lazy(() => import('../components/reporting/AverageMonthlyReportView')),
  'TagBreakdownReportView': lazy(() => import('../components/reporting/TagBreakdownReportView')),
  'PartyLinkedTrialBalanceView': lazy(() => import('../components/reporting/PartyLinkedTrialBalanceView')),
  'ImportAcceptanceView': lazy(() => import('../components/reporting/ImportAcceptanceView')),
  'SalesTrendsView': lazy(() => import('../components/reporting/DocumentTrendsView').then(module => ({default:module.SalesTrendsView}))),
  'PurchaseTrendsView': lazy(() => import('../components/reporting/DocumentTrendsView').then(module => ({default:module.PurchaseTrendsView}))),
  'PaymentMethodSummaryView': lazy(() => import('../components/reporting/PaymentMethodSummaryView')),
  'SpreadWaterfallView': lazy(() => import('../components/reporting/SpreadWaterfallView')),
  'ExchangeRateHistoryView': lazy(() => import('../components/reporting/ExchangeRateHistoryView')),
  'OpenAdvancesView': lazy(() => import('../components/reporting/OpenAdvancesView')),
  'FinancialRatiosReportView': lazy(() => import('../components/reporting/FinancialRatiosReportView')),
  'VendorWithholdingView': lazy(() => import('../components/reporting/VendorWithholdingView')),
  'CustomerTaxCertificatesView': lazy(() => import('../components/reporting/CustomerTaxCertificatesView')),
  'VendorTaxRecordsView': lazy(() => import('../components/reporting/VendorTaxRecordsView')),
  'DiscountMismatchView': lazy(() => import('../components/reporting/DiscountMismatchView')),
  'RegistrationThresholdWatchReportView': lazy(() => import('../components/reporting/RegistrationThresholdWatchReportView')),
  'UseTaxReportView': lazy(() => import('../components/reporting/UseTaxReportView')),
  'ImportServicesReportView': lazy(() => import('../components/reporting/ImportServicesReportView')),
  'ExpensePolicyReportView': lazy(() => import('../components/reporting/ExpensePolicyReportView')),
  'CycleCountReportView': lazy(() => import('../components/reporting/CycleCountReportView')),
  'VendorScorecardReportView': lazy(() => import('../components/reporting/VendorScorecardReportView')),
  'VendorPriceHistoryReportView': lazy(() => import('../components/reporting/VendorPriceHistoryReportView')),
  'SubscriptionPlansReportView': lazy(() => import('../components/reporting/SubscriptionPlansReportView')),
  'CustomerLifetimeValueReportView': lazy(() => import('../components/reporting/CustomerLifetimeValueReportView')),
  'RulePackCoverageReportView': lazy(() => import('../components/reporting/RulePackCoverageReportView')),
  'CustomerCreditLimitReportView': lazy(() => import('../components/reporting/CustomerCreditLimitReportView')),
  'AgedReceivablesByRepReportView': lazy(() => import('../components/reporting/AgedReceivablesByRepReportView')),
  'GrossMarginByItemGroupReportView': lazy(() => import('../components/reporting/GrossMarginByItemGroupReportView')),
  'TopPartiesReportView': lazy(() => import('../components/reporting/TopPartiesReportView')),
  'InventoryTurnoverReportView': lazy(() => import('../components/reporting/InventoryTurnoverReportView')),
  'ExpenseByEmployeeReportView': lazy(() => import('../components/reporting/ExpenseByEmployeeReportView')),
  'TimeByProjectReportView': lazy(() => import('../components/reporting/TimeByProjectReportView')),
  'BankHolidaysReportView': lazy(() => import('../components/reporting/BankHolidaysReportView')),
  'IsraeliBankCodesReportView': lazy(() => import('../components/reporting/IsraeliBankCodesReportView')),
  'GsaPerDiemReportView': lazy(() => import('../components/reporting/GsaPerDiemReportView')),
  'ThreeWayMatchReviewView': lazy(() => import('../components/reporting/ThreeWayMatchReviewView')),
  'ExpenseReceiptChecklistReportView': lazy(() => import('../components/reporting/ExpenseReceiptChecklistReportView')),
  'MilestoneBillingReportView': lazy(() => import('../components/reporting/MilestoneBillingReportView')),
  'ReorderSuggestionsReportView': lazy(() => import('../components/reporting/ReorderSuggestionsReportView')),
  'DunningLettersReportView': lazy(() => import('../components/reporting/DunningLettersReportView')),
  'PriceListImportView': lazy(() => import('../components/platform/settings/PriceListImportView')),
  'DuplicateContactReviewReportView': lazy(() => import('../components/reporting/DuplicateContactReviewReportView')),
  'PurchasePriceVarianceReportView': lazy(() => import('../components/reporting/PurchasePriceVarianceReportView')),
  'SalesByTerritoryReportView': lazy(() => import('../components/reporting/SalesByTerritoryReportView')),
  'RetentionReviewReportView': lazy(() => import('../components/reporting/RetentionReviewReportView')),
  'DuplicateBillsReviewView': lazy(() => import('../components/reporting/DuplicateBillsReviewView')),
  'DocumentNumberGapsReportView': lazy(() => import('../components/reporting/DocumentNumberGapsReportView')),
  'CashForecast13WeekView': lazy(() => import('../components/reporting/CashForecast13WeekView')),
  'Vendor1099ReadinessReportView': lazy(() => import('../components/reporting/Vendor1099ReadinessReportView')),
  'GoldenTaxFixturesReportView': lazy(() => import('../components/reporting/GoldenTaxFixturesReportView')),
  'UsQuarterJourneyReportView': lazy(() => import('../components/reporting/UsQuarterJourneyReportView')),
  'VendorQuotesCompareView': lazy(() => import('../components/reporting/VendorQuotesCompareView')),
  'CustomerItemCodesView': lazy(() => import('../components/reporting/CustomerItemCodesView')),
  'ShippingMethodsView': lazy(() => import('../components/reporting/ShippingMethodsView')),
  'BillRetentionReportView': lazy(() => import('../components/reporting/BillRetentionReportView')),
  'AgedInventoryByLotReportView': lazy(() => import('../components/reporting/AgedInventoryByLotReportView')),
  'WorkOrdersView': lazy(() => import('../components/reporting/WorkOrdersView')),
  'IsraeliAnnualPartySummaryView': lazy(() => import('../components/reporting/IsraeliAnnualPartySummaryView')),
  'IsraelMonthJourneyReportView': lazy(() => import('../components/reporting/IsraelMonthJourneyReportView')),
  'RecordNotesReportView': lazy(() => import('../components/reporting/RecordNotesReportView')),
  'SerialLotLookupReportView': lazy(() => import('../components/reporting/SerialLotLookupReportView')),
  'LandedCostPreviewReportView': lazy(() => import('../components/reporting/LandedCostPreviewReportView')),
  'DeliveryNotesReportView': lazy(() => import('../components/reporting/DeliveryNotesReportView')),
  'CustomerQuotesReportView': lazy(() => import('../components/reporting/CustomerQuotesReportView')),
  'SalesTaxHolidaysReportView': lazy(() => import('../components/reporting/SalesTaxHolidaysReportView')),
  'QuoteVersionsReportView': lazy(() => import('../components/reporting/QuoteVersionsReportView')),
  'BlanketOrdersReportView': lazy(() => import('../components/reporting/BlanketOrdersReportView')),
  'CustomerGrossProfitView': lazy(() => import('../components/reporting/CustomerGrossProfitView')),
  'InactiveItemsReportView': lazy(() => import('../components/reporting/InactiveItemsReportView')),
  'AccountBalancesAsOfView': lazy(() => import('../components/reporting/EverydayReportViews').then(module => ({default:module.AccountBalancesAsOfView}))),
  'PaymentPeriodByInvoiceDateView': lazy(() => import('../components/reporting/EverydayReportViews').then(module => ({default:module.PaymentPeriodByInvoiceDateView}))),
  'CustomerPeriodSummaryView': lazy(() => import('../components/reporting/PartyPeriodSummaryView').then(module => ({default:module.CustomerPeriodSummaryView}))),
  'SupplierPeriodSummaryView': lazy(() => import('../components/reporting/PartyPeriodSummaryView').then(module => ({default:module.SupplierPeriodSummaryView}))),
  'CustomerBalanceSummaryView': lazy(() => import('../components/reporting/CustomerBalanceSummaryView')),
  'VendorBalanceSummaryView': lazy(() => import('../components/reporting/VendorBalanceSummaryView')),
  'ContactBalanceSummaryView': lazy(() => import('../components/reporting/ContactBalanceSummaryView')),
  'TransactionsByCustomerView': lazy(() => import('../components/reporting/TransactionsByCustomerView')),
  'TransactionsByVendorView': lazy(() => import('../components/reporting/TransactionsByVendorView')),
  'TransactionsByReferenceView': lazy(() => import('../components/reporting/TransactionsByReferenceView')),
  'SalesByItemReportView': lazy(() => import('../components/reporting/SalesByItemReportView')),
  'InventoryValuationReportView': lazy(() => import('../components/reporting/InventoryValuationReportView')),
  'JournalSheetReportView': lazy(() => import('../components/reporting/JournalSheetReportView')),
  'MileageRatesReportView': lazy(() => import('../components/reporting/MileageRatesReportView')),
  'IlSelfEmploymentNiReportView': lazy(() => import('../components/reporting/IlSelfEmploymentNiReportView')),
  'IsraelAdvanceTaxReportView': lazy(() => import('../components/reporting/IsraelAdvanceTaxReportView')),
  'BankingValidationReportView': lazy(() => import('../components/reporting/BankingValidationReportView')),
  'KitAssemblyReportView': lazy(() => import('../components/reporting/KitAssemblyReportView')),
  'StockValueByLocationLotReportView': lazy(() => import('../components/reporting/StockValueByLocationLotReportView')),
  'UsNexusWatchReportView': lazy(() => import('../components/reporting/UsNexusWatchReportView')),
  'TaxCodeSuggestionsReportView': lazy(() => import('../components/reporting/TaxCodeSuggestionsReportView')),
  'EntityFilingsCalendarView': lazy(() => import('../components/reporting/EntityFilingsCalendarView')),
  'IsraeliDocumentTypesView': lazy(() => import('../components/reporting/IsraeliDocumentTypesView')),
  'Us1099PreviewReportView': lazy(() => import('../components/reporting/Us1099PreviewReportView')),
  'UsFilingCalendarReportView': lazy(() => import('../components/reporting/UsFilingCalendarReportView')),
  'ExpiringLotsReportView': lazy(() => import('../components/reporting/ExpiringLotsReportView')),
  'StockTransfersReportView': lazy(() => import('../components/reporting/StockTransfersReportView')),
  'DataQualityReportView': lazy(() => import('../components/reporting/DataQualityReportView')),
  'SampleYearBenchmarkReportView': lazy(() => import('../components/reporting/SampleYearBenchmarkReportView')),
  'AccountantQueueView': lazy(() => import('../components/ledger/AccountantQueueView')),
};

export const ANALYTICAL_LENSES_REGISTRY = withScreenHelp([
  { id: 'forensics_1', label: { en: 'Forensic Anomaly Detection', he: 'זיהוי חריגות פיננסיות' }, componentName: 'ToolSandbox' },
  { id: 'forensics_2', label: { en: 'Categorization Consistency Checker', he: 'בדיקת עקביות סיווגים' }, componentName: 'ToolSandbox' }
], 'lenses');

export const LENS_COMPONENTS: Record<string, ElementType> = {
  'ToolSandbox': lazy(() => import('../components/platform/ToolsCatalog'))
};
export const REPORT_TABS_REGISTRY = withScreenHelp([
  { id: 'customer-cohorts', label: { en: 'Customer Cohorts', he: 'קבוצות לקוחות לפי חודש' }, componentName: 'CustomerCohortsReportView', icon: Users },
  { id: 'asset-register', label: { en: 'Asset Register', he: 'רשימת רכוש קבוע' }, componentName: 'AssetRegisterReportView', icon: Building },
  { id: 'one-sided-transfers', label: { en: 'Transfer Check', he: 'בדיקת העברות' }, componentName: 'OneSidedTransfersReportView', icon: ArrowLeftRight },
  { id: 'budget-actual', label: { en: 'Budget vs Actual', he: 'תקציב מול ביצוע' }, componentName: 'BudgetActualReportView', icon: Target },
  { id: 'pnl', label: { en: 'Profit & Loss', he: 'רווח והפסד' }, componentName: 'PNLView', icon: Activity },
  { id: 'balance-sheet', label: { en: 'Balance Sheet', he: 'מאזן' }, componentName: 'BalanceSheetReportView', icon: Layers },
  { id: 'group-summary', label: { en: 'Group Summary', he: 'סיכום קבוצה' }, componentName: 'GroupSummaryReportView', icon: FolderTree },
  { id: 'ask-books', label: { en: 'Ask the Books', he: 'שאלה לספרים' }, componentName: 'AskBooksView', icon: MessageSquareText },
  { id: 'cash-flow', label: { en: 'Cash Flow', he: 'תזרים' }, componentName: 'CashFlowView', icon: RefreshCw },
  { id: 'party-linked-trial-balance', label: { en: 'Party Linked Trial Balance', he: 'מאזן בוחן רישומים מקושרים' }, componentName: 'PartyLinkedTrialBalanceView', icon: BookOpen },
  { id: 'import-acceptance', label: { en: 'Import Acceptance', he: 'קבלת ייבוא' }, componentName: 'ImportAcceptanceView', icon: BookOpen },
  { id: 'sales-trends', label: { en: 'Sales Trends', he: 'מגמות מכירה' }, componentName: 'SalesTrendsView', icon: TrendingUp },
  { id: 'purchase-trends', label: { en: 'Purchase Trends by Vendor', he: 'מגמות רכישה לפי ספק' }, componentName: 'PurchaseTrendsView', icon: ShoppingCart },
  { id: 'sales-payment-summary', label: { en: 'Sales Payment Summary', he: 'תקבולים לפי אמצעי תשלום' }, componentName: 'PaymentMethodSummaryView', icon: CreditCard },
  { id: 'deferred-revenue-waterfall', label: { en: 'Deferred Revenue Waterfall', he: 'מפל הכנסות נדחות' }, componentName: 'SpreadWaterfallView', icon: Calendar },
  { id: 'exchange-rates-used', label: { en: 'Exchange Rates Used', he: 'שערי חליפין ששימשו' }, componentName: 'ExchangeRateHistoryView', icon: TrendingUp },
  { id: 'open-advances', label: { en: 'Open Advances', he: 'מקדמות פתוחות' }, componentName: 'OpenAdvancesView', icon: Calendar },
  { id: 'financial-ratios', label: { en: 'Financial Ratios', he: 'יחסים פיננסיים' }, componentName: 'FinancialRatiosReportView', icon: Activity },
  { id: 'vendor-withholding', label: { en: 'Vendor withholding', he: 'ניכוי במקור לספקים' }, componentName: 'VendorWithholdingView', icon: TrendingUp },
  { id: 'customer-tax-certificates', label: { en: 'Customer tax certificates', he: 'אישורי פטור לקוחות' }, componentName: 'CustomerTaxCertificatesView', icon: Receipt },
  { id: 'vendor-tax-records', label: { en: 'Vendor tax records', he: 'אישורי מס ספקים' }, componentName: 'VendorTaxRecordsView', icon: Receipt },
  { id: 'discount-mismatch', label: { en: 'Discount Mismatch Review', he: 'בדיקת פערי הנחות' }, componentName: 'DiscountMismatchView', icon: TrendingUp },
  { id: 'registration-threshold-watch', label: { en: 'Registration Threshold Watch', he: 'מעקב ספי רישום' }, componentName: 'RegistrationThresholdWatchReportView', icon: Scale },
  { id: 'use-tax-review', label: { en: 'Use Tax Review', he: 'סקירת מס שימוש' }, componentName: 'UseTaxReportView', icon: Coins },
  { id: 'purchases-from-abroad', label: { en: 'Purchases from Abroad', he: 'רכישות מחו"ל' }, componentName: 'ImportServicesReportView', icon: Globe },
  { id: 'expense-policy-check', label: { en: 'Expense Policy Check', he: 'בדיקת מדיניות הוצאות' }, componentName: 'ExpensePolicyReportView', icon: Receipt },
  { id: 'cycle-count', label: { en: 'Inventory Cycle Count', he: 'ספירת מלאי מחזורית' }, componentName: 'CycleCountReportView', icon: ClipboardCheck },
  { id: 'vendor-scorecard', label: { en: 'Vendor Scorecard', he: 'כרטיס ציון ספקים' }, componentName: 'VendorScorecardReportView', icon: TrendingUp },
  { id: 'vendor-price-history', label: { en: 'Vendor Price History', he: 'היסטוריית מחירי ספקים' }, componentName: 'VendorPriceHistoryReportView', icon: TrendingUp },
  { id: 'three-way-match', label: { en: 'Three-Way Match Review', he: 'בדיקת התאמה תלת-כיוונית' }, componentName: 'ThreeWayMatchReviewView', icon: ListChecks },
  { id: 'customer-lifetime-value', label: { en: 'Customer Lifetime Value', he: 'שווי חיי לקוח' }, componentName: 'CustomerLifetimeValueReportView', icon: Users },
  { id: 'subscription-plans', label: { en: 'Subscription Plans', he: 'תוכניות מנוי' }, componentName: 'SubscriptionPlansReportView', icon: RefreshCw },
  { id: 'gross-profit-by-customer', label: { en: 'Gross Profit by Customer', he: 'רווח גולמי לפי לקוח' }, componentName: 'CustomerGrossProfitView', icon: TrendingUp },
  { id: 'inactive-items', label: { en: 'Inactive Items', he: 'פריטים ללא מכירה' }, componentName: 'InactiveItemsReportView', icon: Package },
  { id: 'account-balances-as-of', label: { en: 'Account Balances as of Date', he: 'יתרות חשבון לתאריך' }, componentName: 'AccountBalancesAsOfView', icon: BookOpen },
  { id: 'payment-period-by-invoice-date', label: { en: 'Payment Period by Invoice Date', he: 'תקופת תשלום לפי תאריך חשבונית' }, componentName: 'PaymentPeriodByInvoiceDateView', icon: Calendar },
  { id: 'customer-period-summary', label: { en: 'Customer Period Summary', he: 'סיכום תקופתי לקוחות' }, componentName: 'CustomerPeriodSummaryView', icon: Users },
  { id: 'supplier-period-summary', label: { en: 'Supplier Period Summary', he: 'סיכום תקופתי ספקים' }, componentName: 'SupplierPeriodSummaryView', icon: Building },
  { id: 'customer-balance-summary', label: { en: 'Customer Balance Summary', he: 'יתרות לקוחות' }, componentName: 'CustomerBalanceSummaryView', icon: Users },
  { id: 'vendor-balance-summary', label: { en: 'Vendor Balance Summary', he: 'יתרות ספקים' }, componentName: 'VendorBalanceSummaryView', icon: Building },
  { id: 'contact-balance-summary', label: { en: 'Contact Balance Summary', he: 'יתרות אנשי קשר' }, componentName: 'ContactBalanceSummaryView', icon: Users },
  { id: 'transactions-by-customer', label: { en: 'Transactions by Customer', he: 'עסקאות לפי לקוח' }, componentName: 'TransactionsByCustomerView', icon: FileText },
  { id: 'transactions-by-vendor', label: { en: 'Transactions by Vendor', he: 'עסקאות לפי ספק' }, componentName: 'TransactionsByVendorView', icon: FileSpreadsheet },
  { id: 'transactions-by-reference', label: { en: 'Transactions by Reference', he: 'עסקאות לפי אסמכתא' }, componentName: 'TransactionsByReferenceView', icon: FileText },
  { id: 'sales-by-item', label: { en: 'Sales by Item', he: 'מכירות לפי פריט' }, componentName: 'SalesByItemReportView', icon: Package },
  { id: 'inventory-valuation', label: { en: 'Inventory Valuation', he: 'שווי מלאי' }, componentName: 'InventoryValuationReportView', icon: Package },
  { id: 'goods-not-billed', label: { en: 'Goods Not Yet Billed', he: 'סחורה שטרם חויבה' }, componentName: 'GoodsNotBilledReportView', icon: Package },
  { id: 'bank-clearance', label: { en: 'Bank Clearance Summary', he: 'סיכום סליקה בבנק' }, componentName: 'BankClearanceReportView', icon: BookOpen },
  { id: 'depreciation-ledger', label: { en: 'Asset Depreciation Ledger', he: 'כרטסת פחת נכסים' }, componentName: 'DepreciationLedgerReportView', icon: Layers },
  { id: 'item-register', label: { en: 'Item-wise Register', he: 'יומן לפי פריט' }, componentName: 'ItemRegisterReportView', icon: Package },
  { id: 'stock-aging', label: { en: 'Stock Aging', he: 'גיול מלאי' }, componentName: 'StockAgingReportView', icon: Package },
  { id: 'slow-moving-stock', label: { en: 'Slow-moving Items', he: 'פריטים נעים לאט' }, componentName: 'SlowMovingStockView', icon: Package },
  { id: 'profitability-by', label: { en: 'Profitability by Customer, Item or Project', he: 'רווחיות לפי לקוח, פריט או פרויקט' }, componentName: 'ProfitabilityByView', icon: BarChart3 },
  { id: 'commissions', label: { en: 'Sales Commission', he: 'עמלות מכירה' }, componentName: 'CommissionReportView', icon: UserCheck },
  { id: 'backorders', label: { en: 'Backorders', he: 'הזמנות ממתינות למלאי' }, componentName: 'BackordersReportView', icon: Package },
  { id: 'form-856', label: { en: 'Withholding Report (Form 856)', he: 'דוח ניכוי במקור (טופס 856)' }, componentName: 'Form856ReportView', icon: Receipt },
  { id: 'inventory-details', label: { en: 'Inventory Item Details', he: 'פירוט תנועות מלאי' }, componentName: 'InventoryDetailsReportView', icon: Package },
  { id: 'stock-sources-uses', label: { en: 'Stock Sources and Uses', he: 'מקורות ושימושי מלאי' }, componentName: 'StockSourcesUsesReportView', icon: Package },
  { id: 'expiring-lots', label: { en: 'Expiring Lots', he: 'אצוות שפג תוקפן' }, componentName: 'ExpiringLotsReportView', icon: Package },
  { id: 'stock-transfers', label: { en: 'Stock Transfers', he: 'העברות מלאי' }, componentName: 'StockTransfersReportView', icon: ArrowLeftRight },
  { id: 'kit-assembly', label: { en: 'Kit Assembly', he: 'הרכבת ערכות' }, componentName: 'KitAssemblyReportView', icon: Package },
  { id: 'stock-value-by-location-lot', label: { en: 'Stock Value by Location & Lot', he: 'שווי מלאי לפי מיקום ואצווה' }, componentName: 'StockValueByLocationLotReportView', icon: Package },
  { id: 'journal-sheet', label: { en: 'Journal Sheet', he: 'גיליון יומן' }, componentName: 'JournalSheetReportView', icon: BookOpen },
  { id: 'expense-by-category', label: { en: 'Expense by Category', he: 'הוצאות לפי קטגוריה' }, componentName: 'ExpenseByCategoryReportView', icon: PieChart },
  { id: 'income-by-source', label: { en: 'Income by Source', he: 'הכנסות לפי מקור' }, componentName: 'IncomeBySourceReportView', icon: TrendingUp },
  { id: 'top-expenses-income', label: { en: 'Top Line Items', he: 'הוצאות והכנסות מובילות' }, componentName: 'TopExpensesIncomeReportView', icon: BarChart3 },
  { id: 'monthly-averages', label: { en: 'Monthly Averages', he: 'ממוצעים חודשיים' }, componentName: 'AverageMonthlyReportView', icon: Calendar },
  { id: 'by-label', label: { en: 'Profit by Label', he: 'רווח לפי תגית' }, componentName: 'LabelProfitReportView', icon: Tag },
  { id: 'balance-sheet-by-label', label: { en: 'Balance Sheet by Label', he: 'מאזן לפי תגית' }, componentName: 'LabelBalanceSheetReportView', icon: Tag },
  { id: 'tag-breakdown', label: { en: 'Tag Breakdown', he: 'דוח תגיות' }, componentName: 'TagBreakdownReportView', icon: Tag },
  { id: 'ar-aging', label: { en: 'A/R Aging', he: 'גיול לקוחות' }, componentName: 'ARAgingReportView', icon: Users },
  { id: 'ap-aging', label: { en: 'A/P Aging', he: 'גיול ספקים' }, componentName: 'APAgingReportView', icon: Building },
  { id: 'general-ledger', label: { en: 'General Ledger', he: 'ספר ראשי' }, componentName: 'GeneralLedgerView', icon: BookOpen },
  { id: 'statement', label: { en: 'Account Statement', he: 'דף חשבון' }, componentName: 'StatementView', icon: FileText },
  { id: 'tax-liability', label: { en: 'Sales Tax Liability', he: 'חבות מס קניה' }, componentName: 'TaxLiabilityView', icon: Receipt },
  { id: 'accountant-export-pack', label: { en: 'Accountant export pack', he: 'חבילת ייצוא לרואה חשבון' }, componentName: 'AccountantExportPackView', icon: FileArchive },
  { id: 'rule-pack-coverage', label: { en: 'Tax Rule Coverage', he: 'כיסוי חוקי מס' }, componentName: 'RulePackCoverageReportView', icon: ShieldCheck },
  { id: 'customer-credit-limits', label: { en: 'Customer Credit Limits', he: 'מסגרות אשראי ללקוחות' }, componentName: 'CustomerCreditLimitReportView', icon: Wallet },
  { id: 'aged-receivables-by-rep', label: { en: 'Aged Receivables by Sales Rep', he: 'גיול חובות לקוחות לפי איש מכירות' }, componentName: 'AgedReceivablesByRepReportView', icon: UserCheck },
  { id: 'gross-margin-by-item-group', label: { en: 'Gross Margin by Item Group', he: 'רווח גולמי לפי קבוצת פריטים' }, componentName: 'GrossMarginByItemGroupReportView', icon: PieChart },
  { id: 'top-customers-vendors', label: { en: 'Top Customers and Vendors', he: 'לקוחות וספקים מובילים' }, componentName: 'TopPartiesReportView', icon: TrendingUp },
  { id: 'inventory-turnover', label: { en: 'Inventory Turnover', he: 'מחזור מלאי לפי פריט' }, componentName: 'InventoryTurnoverReportView', icon: RefreshCw },
  { id: 'expense-by-employee', label: { en: 'Expense by Employee', he: 'הוצאות לפי עובד' }, componentName: 'ExpenseByEmployeeReportView', icon: Receipt },
  { id: 'time-by-project', label: { en: 'Time by Person and Project', he: 'שעות לפי עובד ופרויקט' }, componentName: 'TimeByProjectReportView', icon: Clock },
  { id: 'bank-holidays', label: { en: 'Bank Holidays and Due Dates', he: 'ימי חג בנקאיים ומועדי פירעון' }, componentName: 'BankHolidaysReportView', icon: CalendarDays },
  { id: 'israeli-bank-codes', label: { en: 'Israeli Bank and Branch Codes', he: 'קודי בנקים וסניפים בישראל' }, componentName: 'IsraeliBankCodesReportView', icon: Wallet },
  { id: 'gsa-per-diem', label: { en: 'US Per Diem Rates (GSA)', he: 'דמי אש״ל פדרליים בארה״ב (GSA)' }, componentName: 'GsaPerDiemReportView', icon: MapPin },
  { id: 'milestone-billing', label: { en: 'Milestone Billing', he: 'חיוב לפי אבני דרך' }, componentName: 'MilestoneBillingReportView', icon: CalendarDays },
  { id: 'reorder-suggestions', label: { en: 'Reorder Suggestions', he: 'הצעות להזמנה חוזרת' }, componentName: 'ReorderSuggestionsReportView', icon: PackageCheck },
  { id: 'dunning-letters', label: { en: 'Dunning Letters', he: 'מכתבי דרישת תשלום' }, componentName: 'DunningLettersReportView', icon: MailWarning },
  { id: 'expense-receipt-checklist', label: { en: 'Expense Receipt Checklist', he: 'רשימת בדיקת קבלות הוצאות' }, componentName: 'ExpenseReceiptChecklistReportView', icon: Receipt },
  { id: 'duplicate-contact-review', label: { en: 'Duplicate Contact Review', he: 'בדיקת אנשי קשר כפולים' }, componentName: 'DuplicateContactReviewReportView', icon: GitMerge },
  { id: 'purchase-price-variance', label: { en: 'Purchase Price Variance', he: 'שונות מחירי רכש' }, componentName: 'PurchasePriceVarianceReportView', icon: TrendingUp },
  { id: 'sales-by-territory', label: { en: 'Sales by Territory', he: 'מכירות לפי אזור' }, componentName: 'SalesByTerritoryReportView', icon: Globe },
  { id: 'record-retention-review', label: { en: 'Record Retention Review', he: 'בדיקת שמירת רשומות' }, componentName: 'RetentionReviewReportView', icon: Scale },
  { id: 'duplicate-bill-review', label: { en: 'Duplicate Bill Review', he: 'בדיקת חשבוניות כפולות' }, componentName: 'DuplicateBillsReviewView', icon: GitMerge },
  { id: 'document-number-gaps', label: { en: 'Document Number Gaps', he: 'מספרי מסמכים חסרים' }, componentName: 'DocumentNumberGapsReportView', icon: Hash },
  { id: 'cash-forecast-13-week', label: { en: '13-Week Cash Forecast', he: 'תחזית מזומנים ל-13 שבועות' }, componentName: 'CashForecast13WeekView', icon: CalendarClock },
  { id: 'vendor-1099-readiness', label: { en: 'Vendor 1099 Readiness', he: 'מוכנות טפסי 1099 לספקים' }, componentName: 'Vendor1099ReadinessReportView', icon: UserCheck },
  { id: 'golden-tax-fixtures', label: { en: 'Golden Tax Fixtures', he: 'מקרי בדיקה למס' }, componentName: 'GoldenTaxFixturesReportView', icon: ShieldCheck },
  { id: 'us-quarter-journey', label: { en: 'US Quarter Journey', he: 'מסלול רבעון אמריקאי' }, componentName: 'UsQuarterJourneyReportView', icon: ListChecks },
  { id: 'il-month-journey', label: { en: 'Israel Month Journey', he: 'מסלול חודש ישראלי' }, componentName: 'IsraelMonthJourneyReportView', icon: ClipboardCheck },
  { id: 'record-notes', label: { en: 'Record Notes', he: 'הערות על רשומות' }, componentName: 'RecordNotesReportView', icon: FileText },
  { id: 'serial-lot-lookup', label: { en: 'Serial & Lot Lookup', he: 'חיפוש מספרים סידוריים ואצוות' }, componentName: 'SerialLotLookupReportView', icon: Barcode },
  { id: 'landed-cost-preview', label: { en: 'Landed Cost Preview', he: 'תצוגת עלות משלוח ומכס' }, componentName: 'LandedCostPreviewReportView', icon: Package },
  { id: 'delivery-notes', label: { en: 'Delivery Notes', he: 'תעודות משלוח' }, componentName: 'DeliveryNotesReportView', icon: FileText },
  { id: 'customer-quotes', label: { en: 'Customer Quotes & Proposals', he: 'הצעות מחיר ללקוחות' }, componentName: 'CustomerQuotesReportView', icon: FileText },
  { id: 'sales-tax-holidays', label: { en: 'Sales Tax Holidays', he: 'חגי מס מכירה' }, componentName: 'SalesTaxHolidaysReportView', icon: CalendarDays },
  { id: 'quote-versions', label: { en: 'Quote Versions', he: 'גרסאות הצעת מחיר' }, componentName: 'QuoteVersionsReportView', icon: FileSignature },
  { id: 'blanket-orders', label: { en: 'Blanket Purchase Orders', he: 'הזמנות רכש פתוחות' }, componentName: 'BlanketOrdersReportView', icon: Handshake },
  { id: 'mileage-rates', label: { en: 'US Mileage Rates', he: 'תעריפי נסיעה ארה"ב' }, componentName: 'MileageRatesReportView', icon: Truck },
  { id: 'israel-self-employment-ni', label: { en: 'Israel: Self-Employed National Insurance', he: 'ישראל: ביטוח לאומי לעצמאים' }, componentName: 'IlSelfEmploymentNiReportView', icon: Receipt },
  { id: 'israel-advance-tax', label: { en: 'Israel: Advance Tax Calendar (Mikdamot)', he: 'ישראל: מקדמות מס הכנסה' }, componentName: 'IsraelAdvanceTaxReportView', icon: Calendar },
  { id: 'banking-validation', label: { en: 'Banking Data Validation', he: 'אימות נתוני בנק' }, componentName: 'BankingValidationReportView', icon: ShieldCheck },
  { id: 'us-nexus-watch', label: { en: 'US Nexus Watch', he: 'מעקב נקסוס בארה"ב' }, componentName: 'UsNexusWatchReportView', icon: MapPin },
  { id: 'tax-code-suggestions', label: { en: 'Tax Code Suggestions', he: 'הצעות קוד מס' }, componentName: 'TaxCodeSuggestionsReportView', icon: Tag },
  { id: 'entity-filings', label: { en: 'Entity Filings Calendar', he: 'יומן הגשות לישות' }, componentName: 'EntityFilingsCalendarView', icon: CalendarDays },
  { id: 'israeli-document-types', label: { en: 'Israeli Document Types', he: 'סוגי מסמכים בישראל' }, componentName: 'IsraeliDocumentTypesView', icon: Receipt },
  { id: 'us-1099-preview', label: { en: 'US 1099 Preview', he: 'תצוגת 1099 אמריקאי' }, componentName: 'Us1099PreviewReportView', icon: Users },
  { id: 'us-filing-calendar', label: { en: 'US Filing Calendar', he: 'יומן הגשות ארה"ב' }, componentName: 'UsFilingCalendarReportView', icon: Calendar },
  { id: 'data-quality-checks', label: { en: 'Data Quality Checks', he: 'בדיקות איכות נתונים' }, componentName: 'DataQualityReportView', icon: ShieldCheck },
  { id: 'sample-year-benchmark', label: { en: '12-Month Sample Year & Speed', he: 'שנת עסק לדוגמה ומהירות דוחות' }, componentName: 'SampleYearBenchmarkReportView', icon: Activity },
  { id: 'vendor-quotes-compare', label: { en: 'Vendor Quotes Compare', he: 'השוואת הצעות מחיר מספקים' }, componentName: 'VendorQuotesCompareView', icon: Scale },
  { id: 'customer-item-codes', label: { en: 'Customer Item Codes', he: 'מק"טי לקוח לפריטים' }, componentName: 'CustomerItemCodesView', icon: Barcode },
  { id: 'shipping-methods', label: { en: 'Shipping Methods & Rates', he: 'שיטות ותעריפי משלוח' }, componentName: 'ShippingMethodsView', icon: Truck },
  { id: 'bill-retention', label: { en: 'Retention (Holdbacks) on Milestone Bills', he: 'עיכבון בחשבונות אבני דרך' }, componentName: 'BillRetentionReportView', icon: Scale },
  { id: 'aged-inventory-by-lot', label: { en: 'Aged Inventory by Lot', he: 'גיול מלאי לפי אצווה' }, componentName: 'AgedInventoryByLotReportView', icon: Clock },
  { id: 'work-orders', label: { en: 'Work Orders (Kit Assembly)', he: 'פקודות עבודה להרכבת ערכות' }, componentName: 'WorkOrdersView', icon: Layers },
  { id: 'il-annual-party-summary', label: { en: 'Israel: Annual Customer & Vendor Summary', he: 'ישראל: ריכוז שנתי ללקוחות וספקים' }, componentName: 'IsraeliAnnualPartySummaryView', icon: FileSpreadsheet },
  { id: 'accountant-queue', label: { en: 'Accountant Queue', he: 'תור רואה החשבון' }, componentName: 'AccountantQueueView', icon: ClipboardCheck },
], 'reports');

export const SETTINGS_TABS_REGISTRY = withScreenHelp([
  { id: 'rules', label: { en: 'Rules & Automation', he: 'חוקים ואוטומציה' }, componentName: 'RulesSettingsView', icon: SlidersHorizontal },
  { id: 'dimensions', label: { en: 'Dimensions & Labels', he: 'ממדים ותגיות' }, componentName: 'DimensionsView', icon: Tag },
  { id: 'tax-profiles', label: { en: 'Tax profiles', he: 'פרופילי מס' }, componentName: 'TaxProfilesSettingsView', icon: Receipt },
  { id: 'appearance', label: { en: 'Appearance & Display', he: 'מראה ותצוגה' }, componentName: 'AppearanceSettingsView', icon: Sliders },
  { id: 'team', label: { en: 'Team & Invites', he: 'צוות והרשאות' }, componentName: 'TeamView', icon: Users },
  { id: 'billing', label: { en: 'Billing & Plan', he: 'תוכניות וחיוב' }, componentName: 'BillingView', icon: CreditCard },
  { id: 'templates', label: { en: 'Custom Templates', he: 'תבניות' }, componentName: 'TemplatesView', icon: FileText },
  { id: 'security', label: { en: 'Security', he: 'אבטחה' }, componentName: 'SecurityView', icon: ShieldCheck },
  { id: 'rule', label: { en: 'AI & Copilot', he: 'בינה מלאכותית' }, componentName: 'AISettingsView', icon: CpuIcon },
  { id: 'developer', label: { en: 'Developer', he: 'מפתחים' }, componentName: 'DeveloperView', icon: TerminalIcon },
  { id: 'import', label: { en: 'Import Data', he: 'ייבוא נתונים' }, componentName: 'ImportDataView', icon: Upload },
  { id: 'emails', label: { en: 'Emails & Reminders', he: 'מיילים ותזכורות' }, componentName: 'EmailSettingsView', icon: Mail },
  { id: 'branding', label: { en: 'Branding & PDFs', he: 'מיתוג ומסמכים' }, componentName: 'BrandingSettingsView', icon: Palette },
  { id: 'branding-profiles', label: { en: 'Branding per label', he: 'מיתוג לפי תגית' }, componentName: 'BrandingProfilesSettingsView', icon: Palette },
  { id: 'numbering', label: { en: 'Document Numbering', he: 'מספור מסמכים' }, componentName: 'NumberingSettingsView', icon: Hash },
  { id: 'defaults', label: { en: 'Defaults', he: 'ברירות מחדל' }, componentName: 'DefaultsSettingsView', icon: Scale },
  { id: 'schedule', label: { en: 'Schedule', he: 'לוח זמנים' }, componentName: 'ScheduleSettingsView', icon: CalendarClock },
  { id: 'incoming-events', label: { en: 'Incoming events', he: 'אירועים נכנסים' }, componentName: 'IncomingEventsSettingsView', icon: CalendarClock },
  { id: 'tags', label: { en: 'Tags', he: 'תגיות' }, componentName: 'TagsSettingsView', icon: Tag },
  { id: 'scheduled-reports', label: { en: 'Scheduled reports', he: 'דוחות מתוזמנים' }, componentName: 'ScheduledReportsSettingsView', icon: CalendarClock },
  { id: 'alerts', label: { en: 'Alerts', he: 'התראות' }, componentName: 'AlertsSettingsView', icon: BellRing },
  { id: 'modules', label: { en: 'Modules', he: 'מודולים' }, componentName: 'ModulesSettingsView', icon: Blocks },
  { id: 'groups', label: { en: 'Groups of books', he: 'קבוצות ספרים' }, componentName: 'GroupsSettingsView', icon: FolderTree },
  { id: 'split-rules', label: { en: 'Split rules', he: 'כללי פיצול' }, componentName: 'AllocationRulesSettingsView', icon: Split },
  { id: 'price-lists', label: { en: 'Price lists', he: 'מחירונים' }, componentName: 'PriceListsSettingsView', icon: BadgePercent },
  { id: 'price-list-import', label: { en: 'Import price lists', he: 'ייבוא מחירונים' }, componentName: 'PriceListImportView', icon: Upload },
  { id: 'custom-fields', label: { en: 'Custom fields', he: 'שדות מותאמים אישית' }, componentName: 'CustomFieldsSettingsView', icon: ListChecks },
  { id: 'sales-reps', label: { en: 'Sales reps', he: 'אנשי מכירות' }, componentName: 'SalesRepsSettingsView', icon: UserCheck },
  { id: 'stages', label: { en: 'Stages', he: 'שלבים' }, componentName: 'StagesSettingsView', icon: ListChecks },
  { id: 'currencies', label: { en: 'Currencies', he: 'מטבעות' }, componentName: 'CurrenciesSettingsView', icon: Coins },
  { id: 'export', label: { en: 'Backup & Export', he: 'גיבוי וייצוא' }, componentName: 'ExportView', icon: Database },
  { id: 'shortcuts', label: { en: 'Shortcuts', he: 'קיצורי דרך' }, componentName: 'ShortcutsView', icon: Zap }
], 'settings');

export const SETTINGS_COMPONENTS: Record<string, ElementType> = {
  'RulesSettingsView': lazy(() => import('../components/platform/settings/RulesSettings')),
  'DimensionsView': lazy(() => import('../components/platform/settings/DimensionsSettings')),
  'AppearanceSettingsView': lazy(() => import('../components/platform/settings/AppearanceSettings')),
  'TeamView': lazy(() => import('../components/platform/settings/TeamSettings')),
  'BillingView': lazy(() => import('../components/platform/settings/BillingSettings')),
  'TemplatesView': lazy(() => import('../components/platform/settings/BlueprintSettings')),
  'TaxProfilesSettingsView': lazy(() => import('../components/platform/settings/TaxProfilesSettings')),
  'SecurityView': lazy(() => import('../components/platform/settings/SecuritySettings')),
  'AISettingsView': lazy(() => import('../components/platform/settings/AISettings')),
  'DeveloperView': lazy(() => import('../components/platform/settings/DeveloperSettings')),
  'ImportDataView': lazy(() => import('../components/platform/settings/ImportSettings')),
  'EmailSettingsView': lazy(() => import('../components/platform/settings/EmailSettings')),
  'BrandingSettingsView': lazy(() => import('../components/platform/settings/BrandingSettings')),
  'BrandingProfilesSettingsView': lazy(() => import('../components/platform/settings/BrandingProfilesSettings')),
  'NumberingSettingsView': lazy(() => import('../components/platform/settings/NumberingSettings')),
  'DefaultsSettingsView': lazy(() => import('../components/platform/settings/DefaultsSettings')),
  'ExportView': lazy(() => import('../components/platform/settings/BackupExportSettings')),
  'ScheduleSettingsView': lazy(() => import('../components/platform/settings/ScheduleSettings')),
  'IncomingEventsSettingsView': lazy(() => import('../components/platform/settings/IncomingEventsSettings')),
  'TagsSettingsView': lazy(() => import('../components/platform/settings/TagsSettings')),
  'ScheduledReportsSettingsView': lazy(() => import('../components/platform/settings/ScheduledReportsSettings')),
  'AlertsSettingsView': lazy(() => import('../components/platform/settings/AlertsSettings')),
  'ModulesSettingsView': lazy(() => import('../components/platform/settings/ModulesSettings')),
  'GroupsSettingsView': lazy(() => import('../components/platform/settings/GroupsSettings')),
  'AllocationRulesSettingsView': lazy(() => import('../components/platform/settings/AllocationRulesSettings')),
  'PriceListsSettingsView': lazy(() => import('../components/platform/settings/PriceListsSettings')),
  'SalesRepsSettingsView': lazy(() => import('../components/platform/settings/SalesRepsSettings')),
  'StagesSettingsView': lazy(() => import('../components/platform/settings/StagesSettings')),
  'CurrenciesSettingsView': lazy(() => import('../components/platform/settings/CurrenciesSettings')),
  'ShortcutsView': lazy(() => import('../components/platform/settings/ShortcutSettings')),
  // both registered in REPORT_COMPONENTS too; Settings resolves through this map
  'PriceListImportView': lazy(() => import('../components/platform/settings/PriceListImportView')),
  'CustomFieldsSettingsView': lazy(() => import('../components/platform/settings/CustomFieldsSettings'))
};

export const INTELLIGENCE_TABS_REGISTRY = withScreenHelp([
  { id: 'intelligence', label: { en: 'Intelligence', he: 'מודיעין' }, componentName: 'UnifiedIntelligenceCore' }
], 'intelligence');

/** All route screens, including routes outside the sidebar. */
export const SCREEN_TABS_REGISTRY = [
  ...APP_TABS,
  ...withScreenHelp([
    { id: 'architecture', label: { en: 'Architecture Map', he: 'מפת ארכיטקטורה' } },
    { id: 'audit', label: { en: 'Forensic Audit', he: 'ביקורת' } },
    { id: 'time-machine', label: { en: 'Time Machine', he: 'מכונת זמן' } },
    { id: 'ask', label: { en: 'Ask Ledger', he: 'שאלות' } },
    { id: 'magic', label: { en: 'Assisted Entry', he: 'הזנה חכמה' } },
    { id: 'taxes', label: { en: 'Tax Manager', he: 'מסים' } },
    { id: 'consolidation', label: { en: 'Consolidation', he: 'איחוד' } },
    { id: 'accept-invite', label: { en: 'Accept Invitation', he: 'קבלת הזמנה' } },
  ], 'extra'),
  ...REPORT_TABS_REGISTRY.filter(entry => VIEW_COMPONENTS[entry.id] && !APP_TABS.some(tab => tab.id === entry.id)),
  ...dynamicTabs
];
