/**
 * A-39: read-only turnover comparisons for the dated threshold rules. The input is posted ledger
 * revenue only; dimensions classify the activity/entity and tax profiles supply the country fact.
 * It never changes a transaction or concludes that a person is legally required to register.
 */
import type { ChartAccount, DimensionNode, Transaction, TransactionLine } from '../types';
import type { TaxProfiles } from './tax/profile';
import { nodeAncestry } from './tax/profile';
import { composeFacts, type Fact, type FactSources } from './rules/facts';
import { factSources } from './rules/fromTaxProfiles';
import { evaluateRules, type Rule } from './rules/rules';
import { registrationThresholdPack } from './rules/packs/registrationThresholdPack';
import type { RegistrationThresholdEffect } from './rules/packs/shared';
import { canonicalRegistrationThresholdActivity, REGISTRATION_THRESHOLD_ACTIVITIES } from './tax/registrationThresholds';
import { getLineDimension, validateSplitAllocations } from './dimensionUtils';
import { isPostable, isRevenueAccount, isTransferTransaction, lineAmount, transactionDate } from './txFilters';
import { validCustomReportPeriod } from './reportCustomPeriod';

const BOOKS_ENTITY = '\u0000books';
const RULES: Array<Rule<RegistrationThresholdEffect>> = registrationThresholdPack().rules.filter(
  (rule): rule is Rule<RegistrationThresholdEffect> => rule.effect.kind === 'registration-threshold',
);

export interface ThresholdAssessment {
  id: string;
  entityId: string;
  entityName: string;
  activityValue: string;
  activityLabel: string;
  rule: Rule<RegistrationThresholdEffect>;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  salesCents: number;
  thresholdCents: number;
  thresholdCurrency: string;
  baseCurrency?: string;
  comparable: boolean;
  progressPercent: number | null;
  remainingCents: number | null;
  result: 'below' | 'at' | 'over' | 'currency-mismatch';
}

export interface RegistrationThresholdWatch {
  rows: ThresholdAssessment[];
  /** Revenue-account lines omitted because no recognized activity label was assigned. */
  unclassifiedRevenueLineCount: number;
  /** Omitted revenue lines whose split-allocation weights were invalid. */
  invalidSplitLineCount: number;
  /** Entities that have posted sales or a tax profile but no composed country fact. */
  entitiesMissingCountry: string[];
}

export interface RegistrationThresholdWatchInput {
  accounts: readonly ChartAccount[];
  transactions: readonly Transaction[];
  profiles?: TaxProfiles | null;
  dimensionNodes?: readonly DimensionNode[];
  entityDimensionId?: string;
  activityDimensionId?: string;
  asOf: string;
  baseCurrency?: string;
}

interface PostedSale {
  date: string;
  entityId: string;
  activityValue: string;
  salesCents: number;
}

interface PeriodWindow { start: string; end: string; label: string }

function validDate(value: string): boolean {
  return validCustomReportPeriod({ startDate: value, endDate: value });
}

function normalized(value: string): string { return value.normalize('NFC').toLowerCase().trim(); }

/** Resolve a stored node id/description/alias to its stable id, preserving a hierarchical suffix. */
function stableDimensionValue(raw: string, dimensionId: string, nodes: readonly DimensionNode[]): string {
  const parts = raw.split('/');
  const root = parts[0];
  const rootKey = normalized(root);
  const node = nodes.find(candidate => candidate.dimensionId === dimensionId && [candidate.id, candidate.description, ...(candidate.aliases || [])]
    .some(label => normalized(label) === rootKey));
  return node ? [node.id, ...parts.slice(1)].join('/') : raw;
}

/** Match a label's exact code, current description or alias to one of the published activity facts. */
function activityFromLabel(raw: string, dimensionId: string, nodes: readonly DimensionNode[]): string | undefined {
  const direct = canonicalRegistrationThresholdActivity(raw);
  if (direct) return direct;
  const rawKey = normalized(raw);
  const rootKey = normalized(raw.split('/')[0]);
  const node = nodes.find(candidate => candidate.dimensionId === dimensionId && [candidate.id, candidate.description, ...(candidate.aliases || [])]
    .some(label => normalized(label) === rawKey || normalized(label) === rootKey));
  if (!node) return undefined;
  for (const label of [node.id, node.description, ...(node.aliases || [])]) {
    const value = canonicalRegistrationThresholdActivity(label);
    if (value) return value;
  }
  return undefined;
}

function dimensionValue(line: TransactionLine, tx: Transaction, dimensionId: string, nodes: readonly DimensionNode[]): string {
  if (!dimensionId) return 'Unassigned';
  return getLineDimension(line, tx, dimensionId, [...nodes]);
}

function entityKey(raw: string, dimensionId: string, nodes: readonly DimensionNode[]): string {
  if (!raw || raw === 'Unassigned' || !dimensionId) return BOOKS_ENTITY;
  return stableDimensionValue(raw, dimensionId, nodes);
}

function entityLabel(key: string, dimensionId: string, nodes: readonly DimensionNode[], profiles?: TaxProfiles | null): string {
  if (key === BOOKS_ENTITY) return profiles?.books?.name || 'Books (unassigned entity)';
  for (const parent of nodeAncestry(key)) {
    const name = profiles?.labels?.[`${dimensionId}:${parent}`]?.name;
    if (name) return name;
  }
  const [nodeId, ...tail] = key.split('/');
  const node = nodes.find(candidate => candidate.dimensionId === dimensionId && candidate.id === nodeId);
  return node ? [node.description, ...tail].join('/') : key;
}

function quarterStart(asOf: string): string {
  const year = Number(asOf.slice(0, 4));
  const month = Number(asOf.slice(5, 7));
  const firstMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(firstMonth).padStart(2, '0')}-01`;
}

function shiftMonth(day: string, delta: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const targetIndex = year * 12 + month - 1 + delta;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12 + 1;
  const leapYear = targetYear % 4 === 0 && (targetYear % 100 !== 0 || targetYear % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const lastDay = daysInMonth[targetMonth - 1];
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(date, lastDay)).padStart(2, '0')}`;
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

function quarterWindow(start: string, end: string, current: boolean): PeriodWindow {
  const year = Number(start.slice(0, 4));
  const quarter = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
  return {
    start,
    end,
    label: `Q${quarter} ${year}${current ? ' to date' : ''}`,
  };
}

function windowsFor(effect: RegistrationThresholdEffect, asOf: string): PeriodWindow[] {
  const year = Number(asOf.slice(0, 4));
  const currentYearStart = `${year}-01-01`;
  switch (effect.window) {
    case 'calendar-year-to-date':
      return [{ start: currentYearStart, end: asOf, label: `${year} calendar year to date` }];
    case 'rolling-12-months': {
      const priorAnniversary = shiftMonth(asOf, -12);
      const startDate = new Date(Date.parse(`${priorAnniversary}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
      return [{ start: startDate, end: asOf, label: 'Trailing 12 months' }];
    }
    case 'canada-single-quarter-series': {
      const currentStart = quarterStart(asOf);
      const current = quarterWindow(currentStart, asOf, true);
      const prior = Array.from({ length: 4 }, (_, index) => {
        const start = shiftMonth(currentStart, -3 * (index + 1));
        const end = previousDay(shiftMonth(start, 3));
        return quarterWindow(start, end, false);
      });
      return [current, ...prior];
    }
    case 'canada-previous-four-quarters': {
      const currentStart = quarterStart(asOf);
      const end = previousDay(currentStart);
      const start = shiftMonth(currentStart, -12);
      return [{ start, end, label: 'Previous four completed calendar quarters' }];
    }
    case 'eu-current-and-previous-calendar-year':
      return [
        { start: `${year - 1}-01-01`, end: `${year - 1}-12-31`, label: `${year - 1} calendar year (previous year)` },
        { start: currentYearStart, end: asOf, label: `${year} calendar year to date` },
      ];
  }
}

function splitLine(line: TransactionLine, tx: Transaction): Array<{ line: TransactionLine; signedCents: number }> | null {
  const splits = line.splitAllocations || [];
  if (splits.length === 0) return [{ line, signedCents: lineAmount(line, tx) }];
  if (!validateSplitAllocations(splits).valid) return null;
  const full = lineAmount(line, tx);
  const sign = Math.sign(full);
  let assigned = 0;
  return splits.map((split, index) => {
    const signedCents = index === splits.length - 1 ? full - assigned : Math.round(Math.abs(full) * split.weight) * sign;
    assigned += signedCents;
    return {
      line: { ...line, dimensions: { ...(line.dimensions || {}), ...(split.dimensions || {}) }, splitAllocations: undefined },
      signedCents,
    };
  });
}

function isReversalOrReversed(tx: Transaction, reversed: ReadonlySet<string>): boolean {
  return Boolean(tx.type === 'reversal' || tx.metadata?.isReversal || tx.reversalEventId || tx.metadata?.reversesTxId || reversed.has(tx.id));
}

function makeFacts(profiles: TaxProfiles | null | undefined, activityDimensionId: string, activityValue: string): FactSources {
  const sources = factSources(profiles);
  const key = `${activityDimensionId}:${activityValue}`;
  const activityFact: Fact = { attribute: 'activity', value: activityValue, evidence: { kind: 'declared' } };
  sources.labels = { ...(sources.labels || {}), [key]: [activityFact, ...((sources.labels || {})[key] || [])] };
  return sources;
}

function candidatesForEntityDimension(profiles: TaxProfiles | null | undefined, dimensionId: string, nodes: readonly DimensionNode[]): Set<string> {
  const values = new Set<string>();
  const prefix = `${dimensionId}:`;
  for (const key of Object.keys(profiles?.labels || {})) {
    if (key.startsWith(prefix)) values.add(stableDimensionValue(key.slice(prefix.length), dimensionId, nodes));
  }
  return values;
}

/**
 * Turn posted revenue lines into comparison rows. An exact activity label is required; unrecognized
 * and unassigned revenue is counted separately instead of being silently included or treated as zero.
 */
export function registrationThresholdWatch(input: RegistrationThresholdWatchInput): RegistrationThresholdWatch {
  const { accounts, transactions, profiles, asOf } = input;
  const entityDimensionId = input.entityDimensionId || '';
  const activityDimensionId = input.activityDimensionId || '';
  const nodes = input.dimensionNodes || [];
  if (!validDate(asOf)) throw new Error('Choose a valid as-of date.');
  if (entityDimensionId && activityDimensionId && entityDimensionId === activityDimensionId) {
    throw new Error('Choose separate entity and activity dimensions.');
  }

  const accountById = new Map(accounts.map(account => [account.id, account]));
  const reversed = new Set(transactions.map(tx => tx.metadata?.reversesTxId).filter((id): id is string => typeof id === 'string' && id.length > 0));
  const sales: PostedSale[] = [];
  const entities = candidatesForEntityDimension(profiles, entityDimensionId, nodes);
  const unclassifiedLines = new Set<string>();
  const invalidSplitLines = new Set<string>();
  const entityHasSales = new Set<string>();

  for (const tx of transactions) {
    const date = transactionDate(tx);
    if (!isPostable(tx) || !date || date > asOf || isReversalOrReversed(tx, reversed) || isTransferTransaction(tx)) continue;
    for (let index = 0; index < (tx.lines || []).length; index++) {
      const line = tx.lines[index];
      if (line.isTransfer || !isRevenueAccount(accountById.get(line.accountId))) continue;
      const lineKey = `${tx.id}:${line.id || index}`;
      const allocations = splitLine(line, tx);
      if (!allocations) {
        invalidSplitLines.add(lineKey);
        unclassifiedLines.add(lineKey);
        for (const split of line.splitAllocations || []) {
          const splitLineWithLabels = { ...line, dimensions: { ...(line.dimensions || {}), ...(split.dimensions || {}) } };
          const rawEntity = dimensionValue(splitLineWithLabels, tx, entityDimensionId, nodes);
          const entity = entityKey(rawEntity, entityDimensionId, nodes);
          entities.add(entity);
          entityHasSales.add(entity);
        }
        continue;
      }
      for (const allocation of allocations) {
        const rawEntity = dimensionValue(allocation.line, tx, entityDimensionId, nodes);
        const entity = entityKey(rawEntity, entityDimensionId, nodes);
        entities.add(entity);
        entityHasSales.add(entity);
        const storedActivity = activityDimensionId ? getLineDimension(allocation.line, tx, activityDimensionId) : 'Unassigned';
        const displayActivity = dimensionValue(allocation.line, tx, activityDimensionId, nodes);
        const activityValue = activityFromLabel(storedActivity, activityDimensionId, nodes) || activityFromLabel(displayActivity, activityDimensionId, nodes);
        if (!activityValue) {
          unclassifiedLines.add(lineKey);
          continue;
        }
        sales.push({ date, entityId: entity, activityValue, salesCents: -allocation.signedCents });
      }
    }
  }

  // Include the book-level profile even without an entity dimension when revenue has no entity label.
  if (profiles?.books && !entityDimensionId && sales.length > 0) entities.add(BOOKS_ENTITY);
  const entityIds = new Set([...entities, ...entityHasSales]);
  const baseSources = factSources(profiles);
  const order = [...new Set([entityDimensionId, activityDimensionId].filter(Boolean))];
  const entityNames = new Map([...entityIds].map(id => [id, entityLabel(id, entityDimensionId, nodes, profiles)]));
  const entitiesMissingCountry: string[] = [];

  for (const entityId of entityIds) {
    const entityDimensions = entityId === BOOKS_ENTITY || !entityDimensionId ? {} : { [entityDimensionId]: entityId };
    const composed = composeFacts(baseSources, entityDimensions, entityDimensionId ? [entityDimensionId] : [], asOf);
    if (!composed.facts.country?.values.length) entitiesMissingCountry.push(entityNames.get(entityId) || entityId);
  }

  const rows: ThresholdAssessment[] = [];
  const activityLabels = new Map(REGISTRATION_THRESHOLD_ACTIVITIES.map(activity => [activity.value, activity.label]));
  const activityPairs = new Map<string, { entityId: string; activityValue: string }>();
  for (const sale of sales) activityPairs.set(JSON.stringify([sale.entityId, sale.activityValue]), { entityId: sale.entityId, activityValue: sale.activityValue });
  for (const { entityId, activityValue } of activityPairs.values()) {
    const sources = makeFacts(profiles, activityDimensionId, activityValue);
    const entityDimensions = entityId === BOOKS_ENTITY || !entityDimensionId ? {} : { [entityDimensionId]: entityId };
    const dimensions = { ...entityDimensions, ...(activityDimensionId ? { [activityDimensionId]: activityValue } : {}) };
    const composed = composeFacts(sources, dimensions, order, asOf);
    const outcome = evaluateRules(RULES, composed, { date: asOf, scope: 'entity-period' });
    const groupSales = sales.filter(sale => sale.entityId === entityId && sale.activityValue === activityValue);
    for (const { rule } of outcome.applied) {
      if (rule.effect.kind !== 'registration-threshold') continue;
      for (const window of windowsFor(rule.effect, asOf)) {
        const salesCents = groupSales
          .filter(sale => sale.date >= window.start && sale.date <= window.end)
          .reduce((sum, sale) => sum + sale.salesCents, 0);
        const baseCurrency = input.baseCurrency?.toUpperCase();
        const comparable = Boolean(baseCurrency && baseCurrency === rule.effect.currency);
        const progressPercent = comparable ? salesCents / rule.effect.thresholdCents * 100 : null;
        const remainingCents = comparable ? rule.effect.thresholdCents - salesCents : null;
        const result = !comparable ? 'currency-mismatch' : salesCents > rule.effect.thresholdCents ? 'over' : salesCents === rule.effect.thresholdCents ? 'at' : 'below';
        rows.push({
          id: `${entityId}|${activityValue}|${rule.id}|${window.start}`,
          entityId,
          entityName: entityNames.get(entityId) || entityLabel(entityId, entityDimensionId, nodes, profiles),
          activityValue,
          activityLabel: activityLabels.get(activityValue) || activityValue,
          rule,
          periodStart: window.start,
          periodEnd: window.end,
          periodLabel: window.label,
          salesCents,
          thresholdCents: rule.effect.thresholdCents,
          thresholdCurrency: rule.effect.currency,
          ...(baseCurrency ? { baseCurrency } : {}),
          comparable,
          progressPercent,
          remainingCents,
          result,
        });
      }
    }
  }

  return {
    rows: rows.sort((a, b) => a.entityName.localeCompare(b.entityName) || a.rule.name.localeCompare(b.rule.name) || a.periodStart.localeCompare(b.periodStart)),
    unclassifiedRevenueLineCount: unclassifiedLines.size,
    invalidSplitLineCount: invalidSplitLines.size,
    entitiesMissingCountry: [...new Set(entitiesMissingCountry)].sort((a, b) => a.localeCompare(b)),
  };
}
