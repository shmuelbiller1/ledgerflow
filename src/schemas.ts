import { z } from 'zod';

export const SplitAllocationSchema = z.object({
  id: z.string().optional(),
  accountId: z.string().optional(),
  projectId: z.string().optional(),
  weight: z.number().min(0).max(1),
  amountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  notes: z.string().max(500).optional(),
});

export const TransactionLineSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string().optional(),
  amountCents: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  exchangeRate: z.number().positive().finite().default(1),
  description: z.string().max(500).optional(),
  class: z.string().optional(),
  location: z.string().optional(),
  project: z.string().optional(),
  dimensions: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string()).optional(),
  splitAllocations: z.array(SplitAllocationSchema).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  taxAmountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** EG-12: on an invoice's or bill's tax line, the tax code, treatment and parts the document used */
  taxCodeId: z.string().max(200).optional(),
  taxTreatment: z.enum(['standard', 'zero_rated', 'exempt', 'reverse_charge', 'out_of_scope']).optional(),
  taxBreakdown: z.array(z.object({ name: z.string().max(100), rate: z.number().min(0).max(100), taxCents: z.number().int() })).max(10).optional(),
  quantity: z.number().positive().finite().optional(),
  unitPriceCents: z.number().int().nonnegative().optional(),
});

export const TransactionSchema = z.object({
  id: z.string().optional(),
  uid: z.string(),
  workspaceId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  description: z.string().max(2000).default(''),
  totalAmountCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().optional().default('USD'),
  originalCurrency: z.string().optional(),
  exchangeRate: z.number().positive().finite().default(1),
  payee: z.string().optional(),
  status: z.enum(['draft', 'pending', 'certified', 'void', 'reconciled', 'completed', 'failed', 'flagged', 'reviewed', 'overdue', 'approved']).default('pending'),
  type: z.enum(['actual', 'forecast', 'adjustment', 'reversal', 'journal', 'expense', 'income', 'bank_import']).default('actual'),
  lines: z.array(TransactionLineSchema).min(1).max(100),
  tags: z.array(z.string()).max(10).optional(),
  reference: z.string().max(100).optional(),
  projectId: z.string().optional(),
  isCleared: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  parentEventId: z.string().optional(),
  eventId: z.string().optional(),
  reversalEventId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const ChartAccountSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  name: z.string().min(2).max(100),
  code: z.string().regex(/^[a-zA-Z0-9_.-]+$/).optional(),
  type: z.enum(['asset', 'liability', 'equity', 'income', 'expense', 'cost_of_goods', 'revenue', 'other_income', 'other_expense']),
  category: z.string().max(100).optional(),
  subtype: z.string().optional(),
  taxCategory: z.string().optional(),
  currency: z.string().optional(),
  balanceCents: z.number().int().default(0),
  description: z.string().max(500).optional(),
  parentId: z.string().nullable().optional(),
  openingBalanceCents: z.number().int().default(0),
  isActive: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});

export const WorkspaceSchema = z.object({
  id: z.string().optional(),
  uid: z.string(),
  name: z.string().min(2).max(100),
  isClosed: z.boolean().default(false),
  lockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  fiscalYearEnd: z.string().optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  taxRounding: z.enum(['half_up', 'half_even', 'down']).optional(),
  fiscalYearStartDay: z.number().int().min(1).max(28).optional(),
  currency: z.string().default('USD'),
  admins: z.record(z.string(), z.boolean()).optional(),
  createdAt: z.string().optional(),
});

export const BankMappingRequestSchema = z.object({
  transactions: z.array(z.object({
    id: z.string(),
    description: z.string(),
    amountCents: z.number().int(),
  exchangeRate: z.number().optional(),
  })),
  workspaceId: z.string(),
  context: z.string().optional(),
});

export const WorkspaceIdSchema = z.object({
  workspaceId: z.string().min(1)
});

export const ReportRangeSchema = WorkspaceIdSchema.extend({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional()
});

// --- Enterprise Math API Schemas ---
export const DepreciationRequestSchema = z.object({
  type: z.enum(['straight_line', 'declining_balance', 'double_declining_balance', 'sum_of_years_digits']),
  costCents: z.number().int().positive(),
  salvageValueCents: z.number().int().nonnegative(),
  usefulLifePeriods: z.number().int().positive(),
  depreciationRate: z.number().min(0).max(1).optional(),
  multiplier: z.number().positive().max(5).optional(),
  currentPeriod: z.number().int().positive().optional()
}).refine(data => data.salvageValueCents <= data.costCents, {
  message: "salvageValueCents cannot exceed costCents"
});

export const ValuationRequestSchema = z.object({
  equityCents: z.number().int().nonnegative().optional(),
  debtCents: z.number().int().nonnegative().optional(),
  costOfEquity: z.number().nonnegative().optional(),
  costOfDebt: z.number().nonnegative().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  forecastedFCFF: z.array(z.number()).max(100, "Max forecast periods is 100").optional(),
  wacc: z.number().optional(),
  terminalGrowthRate: z.number().min(-0.5).max(0.5).optional(),
  workingCapital: z.number().optional(),
  retainedEarnings: z.number().optional(),
  ebit: z.number().optional(),
  mktValueEquity: z.number().optional(),
  totalLiabilities: z.number().optional(),
  totalAssets: z.number().optional(),
  sales: z.number().optional(),
});

export const TemporalMathRequestSchema = z.object({
  type: z.enum(['tax', 'currency']),
  amountCents: z.number().int(),
  exchangeRate: z.number().positive().finite().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  timeSeries: z.array(z.object({
    validFrom: z.string(),
    validTo: z.union([z.string(), z.null()]),
    value: z.number()
  })).max(1000, "Max time series elements is 1000")
});

export const KPIRequestSchema = z.object({
  netProfitCents: z.number().optional(),
  investmentCostCents: z.number().optional(),
  discountRate: z.number().gt(-1).optional(),
  initialInvestmentCents: z.number().optional(),
  cashFlowsCents: z.array(z.number()).max(100, "Max cashFlow elements is 100").optional(),
  revenueCents: z.number().optional(),
  cogsCents: z.number().optional(),
  fixedCostsCents: z.number().optional(),
  variableCostPerUnitCents: z.number().optional(),
  pricePerUnitCents: z.number().optional(),
  currentAssetsCents: z.number().optional(),
  currentLiabilitiesCents: z.number().optional(),
  inventoryCents: z.number().optional(),
  totalLiabilitiesCents: z.number().optional(),
  totalEquityCents: z.number().optional()
});

export const AmortizationRequestSchema = z.object({
  principalCents: z.number().int().nonnegative(),
  annualInterestRate: z.number().nonnegative(),
  totalPeriods: z.number().int().positive(),
  paymentsPerYear: z.number().int().positive().optional()
});

export const InventoryWACRequestSchema = z.object({
  currentQty: z.number().int().nonnegative(),
  currentValueCents: z.number().int().nonnegative(),
  incomingQty: z.number().int().nonnegative(),
  incomingValueCents: z.number().int().nonnegative()
});

export const InventoryEOQRequestSchema = z.object({
  annualDemand: z.number().int().nonnegative(),
  costPerOrderCents: z.number().int().nonnegative(),
  holdingCostPerUnitCents: z.number().int().nonnegative()
});

export const BankLineUpdateSchema = z.object({
  status: z.enum(['matched', 'unmatched', 'excluded', 'pending', 'reconciled', 'ignored']).optional(),
  matchedTransactionId: z.string().nullable().optional(),
  ruleId: z.string().nullable().optional(),
  category: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  isReviewed: z.boolean().optional(),
  confidence: z.number().min(0).max(1).optional(),
}).strict();

/** A bank statement line sent with an import (POST /api/v1/transactions/bulk); the server adds workspace and user. */
export const BankLineImportSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,127}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  description: z.string().max(1000).default(''),
  amountCents: z.number().int().refine(Number.isSafeInteger),
  status: z.enum(['pending', 'matched']).default('pending'),
  matchedTransactionId: z.string().nullable().optional(),
  accountId: z.string().max(200).optional(),
  /** EG-9: the statement line's source fingerprint (generateImportIdentity); the server keeps one line per fingerprint */
  importIdentity: z.string().min(1).max(300).optional(),
}).strict();

/** Discount, retainage and tax fields shared by invoices and bills (src/lib/taxCodes.ts, documentMath.ts). */
const documentTaxFields = {
  discountCents: z.number().int().nonnegative().optional(),
  retainageCents: z.number().int().nonnegative().optional(),
  depositCents: z.number().int().nonnegative().optional(),
  taxInclusive: z.boolean().optional(),
  taxCents: z.number().int().nonnegative().optional(),
  salesTaxCents: z.number().int().nonnegative().optional(),
  taxVersion: z.literal(2).optional(),
  lineSumCents: z.number().int().optional(),
  taxCodeId: z.string().max(200).optional(),
  taxTreatment: z.enum(['standard', 'zero_rated', 'exempt', 'reverse_charge', 'out_of_scope']).optional(),
  taxBreakdown: z.array(z.object({ name: z.string().max(100), rate: z.number().min(0).max(100), taxCents: z.number().int() })).max(10).optional(),
  pricesIncludeTax: z.boolean().optional(),
};

/** A credit note / vendor credit carries the tax of the document it credits (L-118). */
const creditTaxFields = {
  taxAmountCents: z.number().int().nonnegative().optional(),
  taxInclusive: z.boolean().optional(),
  taxVersion: z.literal(2).optional(),
  taxTreatment: documentTaxFields.taxTreatment,
};

export const InvoiceSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  customerId: z.string().optional(),
  customerName: z.string().max(200).optional(),
  vendorId: z.string().optional(),
  number: z.string().max(100).optional(),
  amountCents: z.number().int().nonnegative().optional(),
  amountPaidCents: z.number().int().nonnegative().optional(),
  settledByRecordsCents: z.number().int().nonnegative().optional(),
  currency: z.string().max(10).optional(),
  exchangeRate: z.number().positive().finite().optional(),
  status: z.enum(['draft', 'pending', 'paid', 'partially_paid', 'overdue', 'sent', 'approved', 'rejected', 'invoiced', 'void', 'cancelled']),
  date: z.string().optional(),
  dueDate: z.string().optional(),
  paymentToken: z.string().optional(),
  notes: z.string().max(2000).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  taxAmountCents: z.number().int().nonnegative().optional(),
  lines: z.array(z.record(z.string(), z.any())).optional(),
  items: z.array(z.record(z.string(), z.any())).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  isLocked: z.boolean().optional(),
  lockedAt: z.string().optional(),
  reversalEventId: z.string().optional(),
  // Fields the invoice form saves that were silently dropped before (L-114)
  type: z.enum(['standard', 'recurring', 'progress', 'estimate', 'quote', 'change-order', 'time-materials']).optional(),
  recurringInterval: z.enum(['monthly', 'weekly', 'yearly']).optional(),
  paymentTerms: z.string().max(50).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  milestone: z.string().max(200).optional(),
  paymentDate: z.string().optional(),
  paidAt: z.string().optional(),
  posted: z.boolean().optional(),
  /** Invoice approval (BE-04): the signature or the note that sent it back (src/lib/invoiceApproval.ts). */
  approval: z.object({
    state: z.enum(['awaiting', 'approved', 'rejected']),
    thresholdCents: z.number().int().nonnegative(),
    requestedAt: z.string().max(60).optional(),
    requestedBy: z.string().max(200).optional(),
    decidedAt: z.string().max(60).optional(),
    decidedBy: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
  }).strict().optional(),
  ...documentTaxFields,
});

export const BillSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  vendorId: z.string().min(1),
  vendorName: z.string().max(200).optional(),
  number: z.string().max(100).optional(),
  amountCents: z.number().int().nonnegative(),
  exchangeRate: z.number().positive().finite().optional(),
  taxAmountCents: z.number().int().nonnegative().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  receiptUrl: z.string().url().or(z.string().max(500)).optional(),
  splits: z.array(z.record(z.string(), z.any())).optional(),
  projectId: z.string().optional(),
  issueDate: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string(),
  status: z.enum(['draft', 'pending', 'approved', 'paid', 'partially_paid', 'overdue', 'unpaid', 'void', 'rejected', 'cancelled']),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  reversalEventId: z.string().optional(),
  isLocked: z.boolean().optional(),
  lockedAt: z.string().optional(),
  paymentToken: z.string().optional(),
  amountPaidCents: z.number().int().nonnegative().optional(),
  settledByRecordsCents: z.number().int().nonnegative().optional(),
  // Fields the bill form saves that were silently dropped before (L-114)
  currency: z.string().max(10).optional(),
  paymentDate: z.string().optional(),
  paidAt: z.string().optional(),
  selfAssessedTaxCents: z.number().int().nonnegative().optional(),
  posted: z.boolean().optional(),
  ...documentTaxFields,
});

export const OrderSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  customerId: z.string().optional(),
  customerName: z.string().max(200).optional(),
  orderNumber: z.string().max(100).optional(),
  number: z.string().max(100).optional(),
  amountCents: z.number().int().nonnegative(),
  status: z.enum(['draft', 'pending', 'shipped', 'cancelled', 'fulfilled', 'completed', 'paid']),
  date: z.string().optional(),
  items: z.array(z.record(z.string(), z.any())).optional(),
  lines: z.array(z.record(z.string(), z.any())).optional(),
  notes: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const ProjectSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  type: z.enum(['book', 'event', 'campaign', 'general']).optional(),
  status: z.enum(['active', 'completed', 'archived']),
  pipelineStage: z.enum(['planning', 'in_progress', 'review', 'completed', 'archived']).optional(),
  budgetCents: z.number().int().nonnegative().optional(),
  costCodes: z.array(z.record(z.string(), z.any())).optional(),
  laborBuckets: z.array(z.record(z.string(), z.any())).optional(),
  materialsBuckets: z.array(z.record(z.string(), z.any())).optional(),
  subcontractCosts: z.array(z.record(z.string(), z.any())).optional(),
  dimensions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  splitRules: z.array(z.record(z.string(), z.any())).optional(),
});

export const AdminUserUpdateSchema = z.object({
  role: z.enum(["client", "admin"]).optional(),
  customLimit: z.number().nonnegative().nullable().optional(),
  computeCreditLimit: z.number().nonnegative().nullable().optional()
}).strict();

export const AdminWorkspaceUpdateSchema = z.object({
  plan: z.enum(["sandbox", "starter", "pro", "enterprise"]).optional(),
  concurrentUserLimit: z.number().nonnegative().optional(),
  maxSeats: z.number().nonnegative().optional(),
  computeCreditBalance: z.number().nonnegative().optional(),
  apiQuotaMonthlyLimitCents: z.number().nonnegative().optional(),
  creditCostMultiplier: z.number().positive().optional(),
  quotaCentsMultiplier: z.number().positive().optional(),
  bypassBilling: z.boolean().optional(),
  customKeyCreditCharge: z.number().nonnegative().optional(),
  customKeyCentsCharge: z.number().nonnegative().optional(),
  freeWorkspaceTxCap: z.number().nonnegative().optional(),
}).strict();

export const AdminGlobalConfigSchema = z.object({
  creditCostMultiplier: z.number().positive(),
  quotaCentsMultiplier: z.number().positive(),
  bypassBilling: z.boolean(),
  customKeyCreditCharge: z.number().nonnegative(),
  customKeyCentsCharge: z.number().nonnegative(),
  maxRegistrationLimit: z.number().nonnegative(),
  freeWorkspaceTxCap: z.number().nonnegative(),
}).strict();

export const ReceiptLineItemSchema = z.object({
  description: z.string().min(1, "Line description is required").max(500),
  amountCents: z.number().int("amountCents must be an integer").min(0),
  category: z.string().min(1, "Category is required").max(500),
  quantity: z.number().positive().finite(),
  unitPriceCents: z.number().int("unitPriceCents must be an integer").min(0),
  tags: z.array(z.string()).optional()
});

export const ReceiptPayloadSchema = z.object({
  vendorName: z.string().min(1, "Vendor name is required").max(200),
  date: z.string().optional(),
  totalAmountCents: z.number().int("totalAmountCents must be an integer").min(0),
  taxAmountCents: z.number().int("taxAmountCents must be an integer").min(0),
  tipAmountCents: z.number().int("tipAmountCents must be an integer").min(0),
  discountAmountCents: z.number().int("discountAmountCents must be an integer").min(0).optional().default(0),
  serviceChargeAmountCents: z.number().int("serviceChargeAmountCents must be an integer").min(0).optional().default(0),
  roundingAdjustmentCents: z.number().int("roundingAdjustmentCents must be an integer").optional().default(0),
  categorySuggestion: z.string().min(1, "Category suggestion is required").max(500),
  lines: z.array(ReceiptLineItemSchema)
});

export const ErrorTelemetrySchema = z.object({
  id: z.string().optional(),
  workspaceId: z.string().max(128).default('unassigned'),
  userId: z.string().max(128).optional(),
  userEmail: z.string().max(256).optional(),
  message: z.string().max(2000),
  stack: z.string().max(4000).optional(),
  componentStack: z.string().max(2000).optional(),
  url: z.string().max(1000).optional(),
  userAgent: z.string().max(500).optional(),
  appVersion: z.string().max(50).optional(),
  release: z.string().max(50).optional(),
  source: z.enum(['frontend', 'backend', 'api']).default('frontend'),
  severity: z.enum(['error', 'warning', 'fatal']).default('error'),
  metadata: z.record(z.string(), z.any()).optional(),
  ticketId: z.string().max(128).optional(),
  createdAt: z.string().optional()
});

export const PaymentAllocationSchema = z.object({
  documentId: z.string().min(1),
  documentType: z.enum(['invoice', 'bill']),
  amountCents: z.number().int().positive()
});

export const PaymentSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  direction: z.enum(['received', 'made']),
  contactId: z.string().min(1),
  contactName: z.string().max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().positive(),
  currency: z.string().optional().default('USD'),
  exchangeRate: z.number().positive().finite().optional(),
  method: z.enum(['cash', 'check', 'bank_transfer', 'card', 'other']),
  reference: z.string().max(200).optional(),
  depositAccountId: z.string().min(1),
  allocations: z.array(PaymentAllocationSchema),
  unappliedCents: z.number().int().nonnegative(),
  status: z.enum(['draft', 'posted', 'void']).default('posted'),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const EstimateSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  customerId: z.string().min(1),
  customerName: z.string().max(200).optional(),
  number: z.string().max(100).optional(),
  amountCents: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiryDate: z.string().optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'declined', 'expired', 'converted']).default('draft'),
  convertedInvoiceId: z.string().optional(),
  lines: z.array(z.object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPriceCents: z.number().int().nonnegative(),
    amountCents: z.number().int().nonnegative()
  })),
  notes: z.string().max(2000).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});

export const CreditNoteSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  customerId: z.string().min(1),
  customerName: z.string().optional(),
  number: z.string().optional(),
  invoiceId: z.string().optional(),
  amountCents: z.number().int().positive(),
  remainingCents: z.number().int().nonnegative().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(1000).optional(),
  status: z.enum(['draft', 'open', 'applied', 'partially_applied', 'void']).default('open'),
  currency: z.string().optional().default('USD'),
  exchangeRate: z.number().positive().finite().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  ...creditTaxFields,
  // BF-06: goods the customer sent back, per stock line of the credited invoice
  returnedGoods: z.array(z.object({
    invoiceLineId: z.string().min(1).max(200),
    itemId: z.string().min(1).max(200),
    quantity: z.number().positive().finite(),
  }).strict()).max(500).optional(),
});

export const VendorCreditSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string(),
  vendorId: z.string().min(1),
  vendorName: z.string().optional(),
  number: z.string().optional(),
  billId: z.string().optional(),
  amountCents: z.number().int().positive(),
  remainingCents: z.number().int().nonnegative().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(1000).optional(),
  status: z.enum(['draft', 'open', 'applied', 'partially_applied', 'void']).default('open'),
  currency: z.string().optional().default('USD'),
  exchangeRate: z.number().positive().finite().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  ...creditTaxFields,
  // BF-07: stock sent back to the vendor, by line of the credited bill
  returnedGoods: z.array(z.object({
    billLine: z.number().int().nonnegative(), itemId: z.string().min(1).max(200),
    quantity: z.number().positive().finite(), valueCents: z.number().int().nonnegative(),
  })).max(500).optional(),
});

export const AutoRuleConditionSchema = z.object({
  vendor: z.string().optional(),
  project: z.string().optional(),
  category: z.string().optional(),
  descriptionContains: z.string().optional(),
  descriptionStartsWith: z.string().optional(),
  amountThreshold: z.number().optional(),
  exactAmount: z.number().optional(),
  minAmountCents: z.number().int().optional(),
  maxAmountCents: z.number().int().optional(),
  dateRange: z.object({ start: z.string(), end: z.string() }).optional(),
}).strict();

export const AutoRuleActionSchema = z.object({
  targetNodeId: z.string().optional(),
  contactId: z.string().max(200).optional(),
  targetProject: z.string().optional(),
  targetCategory: z.string().optional(),
  targetClass: z.string().optional(),
  targetLocation: z.string().optional(),
  targetDimensions: z.record(z.string(), z.string()).optional(),
  targetTags: z.array(z.string()).optional(),
  flagForReview: z.boolean().optional(),
  descriptionPrefix: z.string().optional(),
  descriptionSuffix: z.string().optional(),
  setNotes: z.string().optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  setAmountCents: z.number().int().optional(),
  deleteTransaction: z.boolean().optional(),
}).strict();

export const AutoRuleSchema = z.object({
  id: z.string().optional(),
  uid: z.string().optional(),
  workspaceId: z.string().optional(),
  name: z.string().optional(),
  groupName: z.string().optional(),
  condition: AutoRuleConditionSchema,
  action: AutoRuleActionSchema,
  confidence: z.number().min(0).max(1).default(1),
  isHardened: z.boolean().default(true),
  priority: z.number().int().optional(),
  isActive: z.boolean().default(false),
  stopProcessingOnMatch: z.boolean().optional(),
  hitCount: z.number().int().optional(),
  lastTriggeredAt: z.string().optional(),
  createdBy: z.enum(['user', 'ai', 'system']).optional(),
  createdAt: z.string().optional(),
}).strict();

export type ValidatedTransaction = z.infer<typeof TransactionSchema>;
export type ValidatedChartAccount = z.infer<typeof ChartAccountSchema>;
export type ValidatedWorkspace = z.infer<typeof WorkspaceSchema>;
export type ValidatedTransactionLine = z.infer<typeof TransactionLineSchema>;
