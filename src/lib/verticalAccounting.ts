import type { ChartAccount, Invoice, Payment, Transaction } from '../types';
import { calculateAmountDue } from './documentMath';
import { getLineDimension } from './dimensionUtils';
import { isPostable, lineAmount } from './txFilters';

/**
 * Strategy 3 — High-ARPU Vertical Accounting Engines:
 *  1. Property & Landlord Accounting (Rent Roll, Tenant Sub-Ledger, Owner Statements, 3-Way Security Deposit Trust Reconciliation)
 *  2. Non-Profit Fund & Grant Accounting (ASC 958 Statement of Functional Expenses + Net Asset Restriction Releases)
 *  3. US Parent + Israeli Subsidiary Cross-Border Dual-Tax Compliance Bridge (IL VAT / Allocation # + Form 856 + US 1099 + Cost-Plus TP)
 */

// ============================================================================
// 1. PROPERTY & LANDLORD ACCOUNTING
// ============================================================================

export interface LeaseUnitSpec {
  unitId: string;
  propertyId: string;
  propertyName: string;
  unitLabel: string;
  tenantId?: string | null;
  tenantName?: string | null;
  monthlyRentCents: number;
  leaseStart?: string | null;
  leaseEnd?: string | null;
  securityDepositHeldCents: number;
}

export interface RentRollUnitRow {
  unitId: string;
  propertyId: string;
  propertyName: string;
  unitLabel: string;
  occupancyStatus: 'occupied' | 'expiring_soon' | 'vacant';
  tenantId: string | null;
  tenantName: string | null;
  monthlyRentCents: number;
  delinquentRentCents: number;
  securityDepositHeldCents: number;
  leaseEnd: string | null;
}

export interface PropertyRentRollSummary {
  asOfDate: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRateBps: number;
  scheduledMonthlyRentCents: number;
  potentialGrossMonthlyRentCents: number;
  vacancyLossMonthlyCents: number;
  totalDelinquentRentCents: number;
  totalSecurityDepositsHeldCents: number;
  rows: RentRollUnitRow[];
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

export function computePropertyRentRoll(
  units: readonly LeaseUnitSpec[],
  invoices: readonly Invoice[],
  asOfDate: string,
): PropertyRentRollSummary {
  const delinquentByCustomer = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === 'draft' || inv.status === 'void' || inv.status === 'paid') continue;
    const dueDay = String(inv.dueDate || inv.date || '').slice(0, 10);
    if (!dueDay || dueDay >= asOfDate) continue;
    const due = calculateAmountDue(inv);
    if (due <= 0 || !inv.customerId) continue;
    delinquentByCustomer.set(inv.customerId, (delinquentByCustomer.get(inv.customerId) || 0) + due);
  }

  let occupiedUnits = 0;
  let scheduledMonthlyRentCents = 0;
  let potentialGrossMonthlyRentCents = 0;
  let totalDelinquentRentCents = 0;
  let totalSecurityDepositsHeldCents = 0;

  const rows: RentRollUnitRow[] = units.map(unit => {
    const monthlyRentCents = Math.max(0, Math.trunc(unit.monthlyRentCents));
    const depositCents = Math.max(0, Math.trunc(unit.securityDepositHeldCents));
    potentialGrossMonthlyRentCents += monthlyRentCents;
    totalSecurityDepositsHeldCents += depositCents;

    const isOccupied = Boolean(unit.tenantId || unit.tenantName) &&
      (!unit.leaseEnd || unit.leaseEnd >= asOfDate);

    let occupancyStatus: RentRollUnitRow['occupancyStatus'] = 'vacant';
    if (isOccupied) {
      occupiedUnits += 1;
      scheduledMonthlyRentCents += monthlyRentCents;
      if (unit.leaseEnd) {
        const daysToExpiry = daysBetween(asOfDate, unit.leaseEnd);
        occupancyStatus = daysToExpiry >= 0 && daysToExpiry <= 60 ? 'expiring_soon' : 'occupied';
      } else {
        occupancyStatus = 'occupied';
      }
    }

    const delinquentRentCents = unit.tenantId ? (delinquentByCustomer.get(unit.tenantId) || 0) : 0;
    totalDelinquentRentCents += delinquentRentCents;

    return {
      unitId: unit.unitId,
      propertyId: unit.propertyId,
      propertyName: unit.propertyName,
      unitLabel: unit.unitLabel,
      occupancyStatus,
      tenantId: unit.tenantId || null,
      tenantName: unit.tenantName || null,
      monthlyRentCents,
      delinquentRentCents,
      securityDepositHeldCents: depositCents,
      leaseEnd: unit.leaseEnd || null,
    };
  });

  const totalUnits = units.length;
  const vacantUnits = totalUnits - occupiedUnits;
  const occupancyRateBps = totalUnits > 0 ? Math.round((occupiedUnits * 10_000) / totalUnits) : 0;

  return {
    asOfDate,
    totalUnits,
    occupiedUnits,
    vacantUnits,
    occupancyRateBps,
    scheduledMonthlyRentCents,
    potentialGrossMonthlyRentCents,
    vacancyLossMonthlyCents: potentialGrossMonthlyRentCents - scheduledMonthlyRentCents,
    totalDelinquentRentCents,
    totalSecurityDepositsHeldCents,
    rows,
  };
}

export interface TenantLedgerEntry {
  date: string;
  kind: 'charge' | 'payment';
  reference: string;
  description: string;
  chargeCents: number;
  paymentCents: number;
  runningBalanceCents: number;
}

export function computeTenantLedger(
  tenantId: string,
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  throughDate = '9999-12-31',
): { tenantId: string; endingBalanceCents: number; entries: TenantLedgerEntry[] } {
  const raw: Array<Omit<TenantLedgerEntry, 'runningBalanceCents'>> = [];

  for (const inv of invoices) {
    if (inv.customerId !== tenantId || inv.status === 'draft' || inv.status === 'void') continue;
    const day = String(inv.date || '').slice(0, 10);
    if (!day || day > throughDate) continue;
    const invNotes = (inv as unknown as { notes?: string; memo?: string }).notes || (inv as unknown as { memo?: string }).memo;
    raw.push({
      date: day,
      kind: 'charge',
      reference: inv.number || inv.id,
      description: invNotes || `Rent / Lease Charge (${inv.number || inv.id})`,
      chargeCents: Math.trunc(inv.amountCents || 0),
      paymentCents: 0,
    });
  }

  for (const pay of payments) {
    const payRec = pay as unknown as {
      contactId?: string;
      customerId?: string;
      date?: string;
      paymentDate?: string;
      reference?: string;
      referenceNumber?: string;
      memo?: string;
      notes?: string;
      amountCents?: number;
      status?: string;
    };
    const payerId = payRec.customerId || payRec.contactId;
    if (payerId !== tenantId || payRec.status === 'void') continue;
    const day = String(payRec.paymentDate || payRec.date || '').slice(0, 10);
    if (!day || day > throughDate) continue;
    raw.push({
      date: day,
      kind: 'payment',
      reference: payRec.referenceNumber || payRec.reference || pay.id,
      description: payRec.memo || payRec.notes || 'Tenant payment received',
      chargeCents: 0,
      paymentCents: Math.trunc(payRec.amountCents || 0),
    });
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'charge' ? -1 : 1));

  let runningBalanceCents = 0;
  const entries: TenantLedgerEntry[] = raw.map(item => {
    runningBalanceCents += item.chargeCents - item.paymentCents;
    return {
      ...item,
      runningBalanceCents,
    };
  });

  return {
    tenantId,
    endingBalanceCents: runningBalanceCents,
    entries,
  };
}

export interface OwnerStatementReport {
  propertyId: string;
  period: { from: string; to: string };
  grossRentalIncomeCents: number;
  operatingExpensesCents: number;
  managementFeeBps: number;
  managementFeeCents: number;
  reserveHoldbackCents: number;
  netOwnerDistributionCents: number;
}

export function computeOwnerStatement(input: {
  propertyId: string;
  transactions: readonly Transaction[];
  accounts: readonly ChartAccount[];
  period: { from: string; to: string };
  managementFeeBps: number;
  reserveHoldbackCents?: number;
  dimensionId?: string;
}): OwnerStatementReport {
  const dimId = input.dimensionId || 'location';
  const accountById = new Map(input.accounts.map(a => [a.id, a]));
  let grossRentalIncomeCents = 0;
  let operatingExpensesCents = 0;

  for (const tx of input.transactions) {
    if (!isPostable(tx)) continue;
    const day = String(tx.date || '').slice(0, 10);
    if (!day || day < input.period.from || day > input.period.to) continue;

    for (const line of tx.lines || []) {
      const propVal = getLineDimension(line, tx, dimId) || line.location || line.project;
      if (propVal !== input.propertyId) continue;

      const acc = accountById.get(line.accountId);
      const amt = Math.trunc(lineAmount(line, tx));
      if (acc?.type === 'revenue') {
        grossRentalIncomeCents += -amt;
      } else if (acc?.type === 'expense') {
        operatingExpensesCents += amt;
      }
    }
  }

  const feeBps = Math.max(0, Math.trunc(input.managementFeeBps));
  const managementFeeCents = Math.round((Math.max(0, grossRentalIncomeCents) * feeBps) / 10_000);
  const reserveHoldbackCents = Math.max(0, Math.trunc(input.reserveHoldbackCents || 0));
  const netOwnerDistributionCents =
    grossRentalIncomeCents - operatingExpensesCents - managementFeeCents - reserveHoldbackCents;

  return {
    propertyId: input.propertyId,
    period: input.period,
    grossRentalIncomeCents,
    operatingExpensesCents,
    managementFeeBps: feeBps,
    managementFeeCents,
    reserveHoldbackCents,
    netOwnerDistributionCents,
  };
}

export interface ThreeWayTrustReconciliationInput {
  asOfDate: string;
  bankStatementTrustCents: number;
  outstandingDepositsCents?: number;
  outstandingChecksCents?: number;
  trustCashBookBalanceCents: number;
  trustLiabilityAccountBalanceCents: number;
  tenantSubledgers: ReadonlyArray<{
    unitId: string;
    tenantName: string;
    heldCents: number;
  }>;
}

export interface ThreeWayTrustReconciliationResult {
  asOfDate: string;
  adjustedBankTrustCents: number;
  trustCashBookBalanceCents: number;
  trustLiabilityAccountBalanceCents: number;
  sumTenantSubledgersCents: number;
  bankToBookVarianceCents: number;
  bookToLiabilityVarianceCents: number;
  liabilityToSubledgerVarianceCents: number;
  negativeTenantSubledgers: Array<{ unitId: string; tenantName: string; heldCents: number }>;
  threeWayBalanced: boolean;
}

export function reconcileSecurityDepositTrust(
  input: ThreeWayTrustReconciliationInput,
): ThreeWayTrustReconciliationResult {
  const adjustedBankTrustCents =
    Math.trunc(input.bankStatementTrustCents) +
    Math.trunc(input.outstandingDepositsCents || 0) -
    Math.trunc(input.outstandingChecksCents || 0);
  const trustCashBookBalanceCents = Math.trunc(input.trustCashBookBalanceCents);
  const trustLiabilityAccountBalanceCents = Math.trunc(input.trustLiabilityAccountBalanceCents);
  const sumTenantSubledgersCents = input.tenantSubledgers.reduce(
    (sum, t) => sum + Math.trunc(t.heldCents),
    0,
  );
  const negativeTenantSubledgers = input.tenantSubledgers
    .filter(t => t.heldCents < 0)
    .map(t => ({ unitId: t.unitId, tenantName: t.tenantName, heldCents: Math.trunc(t.heldCents) }));

  const bankToBookVarianceCents = adjustedBankTrustCents - trustCashBookBalanceCents;
  const bookToLiabilityVarianceCents = trustCashBookBalanceCents - trustLiabilityAccountBalanceCents;
  const liabilityToSubledgerVarianceCents = trustLiabilityAccountBalanceCents - sumTenantSubledgersCents;

  return {
    asOfDate: input.asOfDate,
    adjustedBankTrustCents,
    trustCashBookBalanceCents,
    trustLiabilityAccountBalanceCents,
    sumTenantSubledgersCents,
    bankToBookVarianceCents,
    bookToLiabilityVarianceCents,
    liabilityToSubledgerVarianceCents,
    negativeTenantSubledgers,
    threeWayBalanced:
      bankToBookVarianceCents === 0 &&
      bookToLiabilityVarianceCents === 0 &&
      liabilityToSubledgerVarianceCents === 0 &&
      negativeTenantSubledgers.length === 0,
  };
}

// ============================================================================
// 2. NON-PROFIT FUND & GRANT ACCOUNTING (ASC 958 / FORM 990)
// ============================================================================

export type FunctionalExpenseClass = 'program_services' | 'management_and_general' | 'fundraising';

export interface FunctionalExpenseMatrixRow {
  naturalCategory: string;
  programServicesCents: number;
  managementAndGeneralCents: number;
  fundraisingCents: number;
  totalCents: number;
}

export interface StatementOfFunctionalExpenses {
  period: { from: string; to: string };
  rows: FunctionalExpenseMatrixRow[];
  programServicesTotalCents: number;
  managementAndGeneralTotalCents: number;
  fundraisingTotalCents: number;
  grandTotalExpensesCents: number;
  programEfficiencyBps: number;
}

function classifyFunctionalClass(raw: string | undefined): FunctionalExpenseClass {
  const norm = (raw || '').toLowerCase().trim();
  if (norm.includes('fundrais') || norm.includes('development') || norm.includes('donor')) {
    return 'fundraising';
  }
  if (norm.includes('admin') || norm.includes('management') || norm.includes('general') || norm === 'm&g' || norm === 'g&a') {
    return 'management_and_general';
  }
  return 'program_services';
}

export function computeStatementOfFunctionalExpenses(
  transactions: readonly Transaction[],
  accounts: readonly ChartAccount[],
  period: { from: string; to: string },
): StatementOfFunctionalExpenses {
  const accountById = new Map(accounts.map(a => [a.id, a]));
  const byCategory = new Map<string, FunctionalExpenseMatrixRow>();

  for (const tx of transactions) {
    if (!isPostable(tx)) continue;
    const day = String(tx.date || '').slice(0, 10);
    if (!day || day < period.from || day > period.to) continue;

    for (const line of tx.lines || []) {
      const acc = accountById.get(line.accountId);
      const amt = Math.trunc(lineAmount(line, tx));
      const isExpense = acc ? acc.type === 'expense' : amt > 0;
      if (!isExpense || amt === 0) continue;

      const naturalCategory = acc?.name || line.category || line.accountName || 'Operating Expenses';
      const fnHint =
        line.dimensions?.functional ||
        line.department ||
        line.class ||
        (tx.metadata?.functional as string | undefined);
      const fnClass = classifyFunctionalClass(fnHint);

      const row = byCategory.get(naturalCategory) || {
        naturalCategory,
        programServicesCents: 0,
        managementAndGeneralCents: 0,
        fundraisingCents: 0,
        totalCents: 0,
      };
      if (fnClass === 'program_services') row.programServicesCents += amt;
      else if (fnClass === 'management_and_general') row.managementAndGeneralCents += amt;
      else row.fundraisingCents += amt;
      row.totalCents += amt;
      byCategory.set(naturalCategory, row);
    }
  }

  const rows = [...byCategory.values()].sort((a, b) => a.naturalCategory.localeCompare(b.naturalCategory));
  const programServicesTotalCents = rows.reduce((s, r) => s + r.programServicesCents, 0);
  const managementAndGeneralTotalCents = rows.reduce((s, r) => s + r.managementAndGeneralCents, 0);
  const fundraisingTotalCents = rows.reduce((s, r) => s + r.fundraisingCents, 0);
  const grandTotalExpensesCents = programServicesTotalCents + managementAndGeneralTotalCents + fundraisingTotalCents;
  const programEfficiencyBps =
    grandTotalExpensesCents > 0 ? Math.round((programServicesTotalCents * 10_000) / grandTotalExpensesCents) : 0;

  return {
    period,
    rows,
    programServicesTotalCents,
    managementAndGeneralTotalCents,
    fundraisingTotalCents,
    grandTotalExpensesCents,
    programEfficiencyBps,
  };
}

export function buildRestrictionReleaseEntries(input: {
  fundName: string;
  releaseDate: string;
  qualifyingExpenseCents: number;
  maxAvailableRestrictedCents: number;
  restrictedReleaseAccountId: string;
  unrestrictedReleaseAccountId: string;
}) {
  const releaseCents = Math.max(
    0,
    Math.min(Math.trunc(input.qualifyingExpenseCents), Math.trunc(input.maxAvailableRestrictedCents)),
  );
  const remainingRestrictedCents = Math.max(0, Math.trunc(input.maxAvailableRestrictedCents) - releaseCents);

  return {
    fundName: input.fundName,
    releaseDate: input.releaseDate,
    releasedCents: releaseCents,
    remainingRestrictedCents,
    lines: releaseCents > 0
      ? [
          {
            accountId: input.restrictedReleaseAccountId,
            amountCents: releaseCents, // Debit Net Assets Released (reduces donor-restricted net assets)
            description: `ASC 958 Release from donor restriction — ${input.fundName}`,
            dimensions: { fund: input.fundName },
          },
          {
            accountId: input.unrestrictedReleaseAccountId,
            amountCents: -releaseCents, // Credit Net Assets Without Donor Restrictions
            description: `ASC 958 Satisfaction of program restriction — ${input.fundName}`,
            dimensions: { fund: 'Unrestricted' },
          },
        ]
      : [],
  };
}

// ============================================================================
// 3. US PARENT + ISRAELI SUBSIDIARY DUAL-TAX CROSS-BORDER BRIDGE
// ============================================================================

export interface UsIsraelDualTaxInput {
  /** Israeli subsidiary VAT-bearing sales & purchases in agorot (1 ILS = 100 agorot). */
  ilSalesNetAgorot: number;
  ilOutputVatAgorot: number;
  ilInputVatRecoverableAgorot: number;
  /** Israeli B2B domestic invoices in agorot (checked against Israel Tax Authority Allocation Number threshold). */
  ilDomesticB2bInvoices: ReadonlyArray<{
    invoiceNumber: string;
    netAmountAgorot: number;
    allocationNumber?: string | null;
  }>;
  /** Statutory ITA Allocation Number threshold in agorot (default 1,000,000 agorot = ₪10,000 pre-VAT). */
  ilAllocationThresholdAgorot?: number;
  /** Israeli subsidiary operating R&D cost base in agorot and actual intercompany recharge billed to US parent in USD cents. */
  ilOperatingCostAgorot: number;
  intercompanyBilledToUsParentUsdCents: number;
  /** Explicit period-average ILS-to-USD rate (e.g. 0.275 USD per 1 ILS). Never guessed. */
  ilsToUsdRate: number;
  /** Target arm's-length R&D cost-plus markup in bps (e.g. 800 = 8.0% markup under IRC §482 / ITO §85A). */
  targetCostPlusMarkupBps: number;
  /** US parent vendor disbursements for 1099-NEC threshold check ($600 = 60,000 cents). */
  usVendorPayments: ReadonlyArray<{
    vendorId: string;
    vendorName: string;
    paidUsdCents: number;
    isCorporation?: boolean;
    hasW9OnFile?: boolean;
  }>;
}

export interface UsIsraelDualTaxSummary {
  netIlVatPayableAgorot: number;
  missingAllocationInvoices: string[];
  ilOperatingCostUsdCents: number;
  expectedArmLengthRechargeUsdCents: number;
  actualIntercompanyRechargeUsdCents: number;
  transferPricingVarianceUsdCents: number;
  transferPricingCompliant: boolean;
  us1099ReportableCount: number;
  us1099MissingW9Vendors: string[];
}

export function computeUsIsraelDualTaxSummary(input: UsIsraelDualTaxInput): UsIsraelDualTaxSummary {
  if (!(input.ilsToUsdRate > 0) || !Number.isFinite(input.ilsToUsdRate)) {
    throw new Error('Explicit positive ilsToUsdRate is required for US+Israel dual-tax translation');
  }

  const netIlVatPayableAgorot =
    Math.trunc(input.ilOutputVatAgorot) - Math.trunc(input.ilInputVatRecoverableAgorot);

  const thresholdAgorot = Math.trunc(input.ilAllocationThresholdAgorot ?? 1_000_000); // ₪10,000
  const missingAllocationInvoices = input.ilDomesticB2bInvoices
    .filter(inv => Math.trunc(inv.netAmountAgorot) >= thresholdAgorot && !String(inv.allocationNumber || '').trim())
    .map(inv => inv.invoiceNumber);

  // Translate IL R&D cost base from agorot (1/100 ILS) to USD cents (1/100 USD)
  const ilOperatingCostUsdCents = Math.round(Math.trunc(input.ilOperatingCostAgorot) * input.ilsToUsdRate);
  const markupBps = Math.max(0, Math.trunc(input.targetCostPlusMarkupBps));
  const expectedArmLengthRechargeUsdCents = Math.round(
    (ilOperatingCostUsdCents * (10_000 + markupBps)) / 10_000,
  );
  const actualIntercompanyRechargeUsdCents = Math.trunc(input.intercompanyBilledToUsParentUsdCents);
  const transferPricingVarianceUsdCents =
    actualIntercompanyRechargeUsdCents - expectedArmLengthRechargeUsdCents;

  // Allow up to 1% (100 bps) rounding tolerance on arm's-length recharge
  const toleranceCents = Math.max(100, Math.round(expectedArmLengthRechargeUsdCents * 0.01));
  const transferPricingCompliant = Math.abs(transferPricingVarianceUsdCents) <= toleranceCents;

  const reportableVendors = input.usVendorPayments.filter(
    v => !v.isCorporation && Math.trunc(v.paidUsdCents) >= 60_000,
  );
  const us1099MissingW9Vendors = reportableVendors
    .filter(v => !v.hasW9OnFile)
    .map(v => v.vendorName);

  return {
    netIlVatPayableAgorot,
    missingAllocationInvoices,
    ilOperatingCostUsdCents,
    expectedArmLengthRechargeUsdCents,
    actualIntercompanyRechargeUsdCents,
    transferPricingVarianceUsdCents,
    transferPricingCompliant,
    us1099ReportableCount: reportableVendors.length,
    us1099MissingW9Vendors,
  };
}
