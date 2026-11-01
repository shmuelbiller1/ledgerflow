import type { LockException } from '../lib/periodLock';
import type { EmailTemplates } from '../lib/emailTemplates';
import type { WorkspaceBranding } from '../lib/branding';
import type { ReminderSettings } from '../lib/reminders';
import type { InvoiceApprovalSettings } from '../lib/invoiceApproval';
import type { MoneyDisplaySettings } from '../lib/moneyFormat';
import type { ScheduledReport } from '../lib/scheduledReports';
import type { CloseStep } from '../lib/closeSteps';
import type { AllocationRule } from '../lib/allocationRules';
import type { PriceList } from '../lib/priceLists';
import type { SalesRep } from '../lib/salesReps';
import type { RoleDashboards } from '../lib/dashboardOverview';
import type { ApprovalDelegate } from '../lib/approvalDelegation';
import type { LedgerHealth } from '../lib/ledgerHealth';
import type { AlertSettings, AlertsSent } from '../lib/bookAlerts';
import type { NotificationType } from '../lib/notifications';
import type { CustomFieldDef } from '../lib/customFields';
import type { EntityMetadata, DimensionDefinition, Transaction } from './ledger';

// Workspaces, people and the app: members, invites, notifications, audit log, dashboards, partners.
// Part of src/types.ts (F-10): import from '../types' as before; it re-exports this file.

/** One person's in-app notification (table `notifications`, created by the server). */
export interface AppNotification {
  id: string;
  workspaceId: string;
  uid: string;
  kind: NotificationType;
  title: string;
  message: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
  linkTab?: string;
  recordId?: string;
  eventKey?: string;
}

export interface Workspace {
  id: string;
  uid: string;
  name: string;
  businessType: string; // Template ID or "custom"
  type?: string;        // Alias for businessType used in some views
  description?: string;
  createdAt: string;
  lockedUntilDate?: string;
  lockDate?: string | null;
  /** Soft close (src/lib/periodLock.ts): only owners and accountants post on or before it. Server-only. */
  softLockDate?: string | null;
  /** Partial unlock of a closed date range. Server-only. */
  lockException?: LockException | null;
  /** Workspace email texts (src/lib/emailTemplates.ts); missing ones use the defaults. */
  emailTemplates?: EmailTemplates;
  /** Logo, colour, address, footer and terms on document PDFs (src/lib/branding.ts); set by the server. */
  branding?: WorkspaceBranding;
  /** Automatic payment reminders (src/lib/reminders.ts). */
  reminderSettings?: ReminderSettings;
  /** Invoice approval (BE-04, src/lib/invoiceApproval.ts): invoices over the limit wait for a signature. */
  invoiceApproval?: InvoiceApprovalSettings;
  /** How money is shown (C-25, src/lib/moneyFormat.ts): display only, never changes an amount. */
  moneyDisplay?: MoneyDisplaySettings;
  /** Scheduled reports (K-28, src/lib/scheduledReports.ts): emailed after each finished week or month. */
  scheduledReports?: ScheduledReport[];
  /** A-37 (CG-01, src/lib/customFields.ts): owner-defined extra fields on customers, vendors and items; values live in each record's metadata. */
  customFields?: CustomFieldDef[];
  /** Which period each schedule last sent (written by the server only). */
  scheduledReportsSent?: Record<string, string>;
  /** The client's own month-end steps (BD-10, src/lib/closeSteps.ts); saved by the server for owners and accountants. */
  closeSteps?: CloseStep[];
  /** Q-05: saved split (cost allocation) rules, suggested on bills (src/lib/allocationRules.ts); saved by the server. */
  allocationRules?: AllocationRule[];
  /** M-11: price lists for some customers, filled on invoice and estimate lines (src/lib/priceLists.ts); saved by the server. */
  priceLists?: PriceList[];
  /** P-13: sales reps, their commission and customers (src/lib/salesReps.ts); saved by the server. */
  salesReps?: SalesRep[];
  /** The nightly ledger health check (CA-32, src/lib/ledgerHealth.ts); written by the server only. */
  ledgerHealth?: LedgerHealth;
  /** Alerts about the books (S-08, S-10, S-11, src/lib/bookAlerts.ts); saved by the server for owners and accountants. */
  alerts?: AlertSettings;
  /** EG-4: a posting over a budget: 'warn' (default) posts and says so, 'block' refuses it, 'off' checks nothing. Owners change it (server only). */
  budgetControl?: 'off' | 'warn' | 'block';
  /** What the alerts already told (written by the server only). */
  alertsSent?: AlertsSent;
  /** U-10: pay runs prepared by others wait for an owner's approval (set by owners, through the server). */
  payrollApproval?: boolean;
  /** P-05: nobody approves what they prepared (src/lib/twoPersonRule.ts; set by owners, through the server). */
  twoPersonRule?: boolean;
  /** PLAN §6: tax profiles of the books and of label values (src/lib/tax/profile.ts; set through the server, coming). */
  taxProfiles?: import('../lib/tax/profile').TaxProfiles;
  /** A-77: branding overrides per label value, inherited down the label tree; set through the server (src/lib/entityBranding.ts). */
  brandingProfiles?: import('../lib/entityBranding').BrandingProfiles;
  /** BC-02: each role's starting dashboard layout (src/lib/dashboardOverview.ts; set by owners, through the server). */
  roleDashboards?: RoleDashboards;
  /** BG-07: who approves invoices in an owner's or accountant's place, until when (set through the server). */
  approvalDelegates?: ApprovalDelegate[];
  /** W-06: refuse sales that would take an item's stock below zero (written by the server only, owners) */
  refuseNegativeStock?: boolean;
  /** BF-08 step 2: when stock leaves, with the invoice (default) or with a delivery (src/lib/deliveries.ts; server only, owners) */
  goodsLeaveWith?: 'invoice' | 'delivery';
  /** BB-07: which modules are on (src/lib/modules.ts; written by the server only, owners and accountants) */
  modules?: Record<string, boolean>;
  /** Y-30: everyone in the workspace must use two-step login (set by owners, through the server). */
  requireTwoStep?: boolean;
  /** Set by the daily job: the month (YYYY-MM) monthly statements were last sent (Y-28). */
  lastStatementsMonth?: string;
  strategicAdvice?: string[];
  analyticalTopology?: DashboardSchema;
  currency?: string;
  defaultAccountMappings?: Record<string, string>;
  isDemoLoaded?: boolean;
  dateFormat?: string;
  aiModel?: string;
  matchingThreshold?: number;
  timezone?: string;
  /** Saved CSV column layouts for statement imports, keyed by header signature (src/lib/importColumnMaps.ts). */
  importColumnMaps?: Record<string, import('../lib/importColumnMaps').SavedColumnMap>;
  /** A-74: the organisation's expense policy rows (src/lib/expensePolicy.ts); owners set them through the server. */
  expensePolicy?: import('../lib/expensePolicy').ExpensePolicy;
  notifications?: {
    largeTransactionAlert: boolean;
    largeTransactionThreshold: number;
    anomalyAlert: boolean;
  };
  // Billing & Tenant Resource Constraints
  plan?: 'free' | 'growth' | 'pro' | 'enterprise';
  billingCycle?: 'monthly' | 'yearly' | 'free';
  paymentStatus?: 'active' | 'past_due' | 'unpaid' | string;
  trialEndsAt?: string;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  concurrentUserLimit?: number;
  activeUserCount?: number;
  maxSeats?: number;
  seatCount?: number;
  totalQueriesThisMonth?: number;
  computeHardnessScore?: number;
  billingLedgerChain?: string;
  apiQuotaTotalCentsUsed?: number;
  apiQuotaMonthlyLimitCents?: number;
  computeCreditBalance?: number;
  fiscalYearStartMonth?: number;
  /** Y-35: how tax on a document is rounded to cents (unset = half up). */
  taxRounding?: 'half_up' | 'half_even' | 'down';
  fiscalYearStartDay?: number;
  fiscalYearEnd?: string;
  // Set only by the server or a platform admin (the database refuses them from the browser)
  isClosed?: boolean;
  computeLimit?: number;
  lastUpgradedAt?: string;
  deletedAt?: string;
  scheduledPurgeAt?: string;
  /** First-run setup finished (src/server/services/openingBalanceService.ts). Server-only. */
  setupCompletedAt?: string;
  /** The start date of the books (opening balances). Server-only. */
  openingBalanceDate?: string;
  /** How long logs are kept, recovery window, legal hold (src/lib/retention.ts). Server-only. */
  retention?: Partial<import('../lib/retention').RetentionSettings>;
  /** 'pending_deletion' while a deleted workspace waits out its 30 days */
  status?: string;
  creditCostMultiplier?: number;
  quotaCentsMultiplier?: number;
  customKeyCreditCharge?: number;
  customKeyCentsCharge?: number;
  freeWorkspaceTxCap?: number;
  dimensions?: DimensionDefinition[]; // Dynamic workspace dimensional coordinate schema
  allowedWorldPaths?: string[];       // Coordinate-scoped permissions for sub-ledgers
  numberingSeries?: Record<string, { prefix: string; nextNumber: number; padding: number }>;
  roles?: Record<string, 'owner' | 'accountant' | 'bookkeeper' | 'viewer'>;
}

export interface DashboardSchema {
  name?: string;
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export interface TopologyNode {
  id: string;
  name?: string;
  label?: string;
  type: string;
  position: {
    x: number;
    y: number;
  };
  valueCents: number;
  overrideValueCents?: number;
  config: {
    filter?: Record<string, string>;
    formula?: string;
    targetId?: string;
    taxCategory?: string;
    accountingGroup?: string;
    color?: string;
  };
}

export interface TopologyLink {
  id?: string;
  source: string;
  target: string;
  weight: number;
  type?: string;
}

export type SelectionState = {
  nodes: string[];
  links: string[];
};

export interface Partner {
  id: string;
  uid: string;
  name: string;
  share: number;
  initialCapitalCents: number;
  createdAt: string;
}

export interface AuditLogDetails {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedFields?: string[];
  description?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface AuditLog {
  id: string;
  uid: string;
  email?: string;
  userEmail?: string;
  action: string;
  entityType: string;
  entityId: string;
  details: AuditLogDetails;
  timestamp: string;
}

export interface WorkspaceInvite {
  id?: string;
  inviteId?: string;
  workspaceId: string;
  email: string;
  role: 'owner' | 'accountant' | 'bookkeeper' | 'viewer';
  expiresAt: string;
  createdAt?: string;
  token: string;
  signature?: string;
  invitedByUid?: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface PartnerSplit {
  id: string;
  name: string;
  share: number; // Percentage
  initialCapitalCents: number;
}

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoUrl?: string;
  role: 'admin' | 'client';
  geminiApiKey?: string;
  createdAt?: string;
  lastLoginAt?: string;
  metadata?: EntityMetadata;
  plan?: 'free' | 'growth' | 'enterprise';
  seatIndex?: number;
  isActiveSession?: boolean;
}

export type UserProfile = User;

export interface AnalyticalMetrics {
  kpis: {
    revenue: number;
    prevRevenue: number;
    expenses: number;
    prevExpenses: number;
    netCash: number;
    prevNetCash: number;
    burnRate: number;
    prevBurnRate: number;
    totalCash: number;
    runwayMonths: number;
    healthScore: number;
    complianceScore: number;
    volatility: number;
    cashVelocity: number;
    concentrationIndex: number;
    grossMargin: number;
    operatingMargin: number;
    currentRatio: number;
    quickRatio: number;
    yieldEfficiency: number;
    prevHealthScore?: number;
    monteCarloRunway?: { confidence95: number; confidence50: number; failureProbability: number };
    correlations?: { pairs: { a: string; b: string; score: number; lag: number }[] };
  };
  trends: {
    revenue: number;
    expenses: number;
    netCash: number;
    burnRate: number;
  };
  timeSeries: {
    date: string;
    inflow: number;
    outflow: number;
    balance: number;
    net: number;
  }[];
  allocations: {
    name: string;
    value: number;
  }[];
  recentActivity: Transaction[];
  anomalies: {
    transactionId: string;
    score: number; // 0-1
    reason: string;
    zScore?: number;
    signature?: string;
  }[];
  periodicity: {
    period: number;
    confidence: number;
    label: string;
  }[];
  graphCentrality: {
    id: string;
    name: string;
    score: number;
    type: 'account' | 'merchant';
  }[];
  layerStatus: {
    name: string;
    status: 'active' | 'standby' | 'error';
    algorithm: string;
  }[];
}

export type AppTab = string;
