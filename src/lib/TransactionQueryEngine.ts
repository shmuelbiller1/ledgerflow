import { normalizeSearchText, unquoteSearchValue } from './textNormalization';
import { FilterCriteria, ChartAccount, Transaction, TransactionLine, DimensionNode } from '../types';
import type { SavedView } from '../stores/useSavedViewsStore';
import { LedgerEngine } from '../kernel/ledger/LedgerEngine';
import { jaroWinklerSimilarity } from '../lib/algorithms';
import { TruthEngine } from '../modules/integrity/TruthEngine';
import { format } from 'date-fns';
import { parseLocalDate, resolveAccountName } from '../lib/utils';
import { isSimulationTransaction, isTransactionInDateRange } from './txFilters';
import { searchTransactions } from './serverSearch';

// RULES PATTERN ENGINE: Pre-compiled static regex for maximum pipeline throughput
export const PATTERNS = {
  OP: /(>=|<=|[><=])\s*([\d,]+(?:\.\d+)?)/,
  TEXT_OP: /(greater than|more than|over|above|less than|under|below|at least|at most|around|about|approx|approximately)\s*([\d,]+(?:\.\d+)?)/,
  RANGE: /between\s*([\d,]+(?:\.\d+)?)\s*and\s*([\d,]+(?:\.\d+)?)/,
  PERCENTILE: /\b(top|bottom)\s*(10|25|50)\s*%?\b/,
  MONTH: /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/,
  YEAR: /\b(20\d{2})\b/,
  RELATIVE: /\b(last month|this month|last week|this week|yesterday|today|last year|this year|last 7 days|last 30 days|ytd)\b/,
  QUARTER: /\b(q[1-4])\b/,
  DATE_RANGE: /(\d{4}-\d{2}-\d{2})\s*(?:to|and)\s*(\d{4}-\d{2}-\d{2})/,
  SINCE_DATE: /\b(since|after)\s*(\d{4}-\d{2}-\d{2})\b/,
  BEFORE_DATE: /\b(before|until)\s*(\d{4}-\d{2}-\d{2})\b/,
  CATEGORY: /(category|type|account):\s*([\p{L}\p{M}\p{N}\s]+)/u,
  PROJECT: /(project|initiative|tag):\s*([\p{L}\p{M}\p{N}\s]+)/u,
  CLASS: /(class|segment):\s*([\p{L}\p{M}\p{N}\s]+)/u,
  LOCATION: /(location|office|site):\s*([\p{L}\p{M}\p{N}\s]+)/u,
  STARTS_WITH: /starts\s+with\s+("[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}\s]+)/u,
  ENDS_WITH: /ends\s+with\s+("[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}\s]+)/u,
  CONTAINS: /contains\s+("[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}\s]+)/u,
  ERROR: /\b(error|mismatch|conflict|audit|review|unbalanced)\b/,
  AVERAGE: /\b(above|below)\s+average\b/,
};

type NormalizedTransaction = Pick<Transaction, 'id' | 'date' | 'description' | 'totalAmountCents'> & Partial<Omit<Transaction, 'lines'>> & {
  lines?: (TransactionLine & { memo?: string })[];
  notes?: string;
  _normalized?: { absAmount: number; sanitizedDescription: string; searchStr?: string };
};
type QuerySavedView = Pick<SavedView, 'filter'> & Partial<Omit<SavedView, 'filter'>> & { filter: SavedView['filter'] & { includeSimulations?: boolean } };

export interface QueryEngineOptions<T extends NormalizedTransaction = NormalizedTransaction> {
  normalized: T[];
  filterCriteria: FilterCriteria | null;
  searchTerm: string;
  accounts: ChartAccount[];
  activeView: QuerySavedView | undefined | null;
  dimensionNodes: DimensionNode[];
  reverseDimensionIndex: Map<string, Set<string>>;
  thresholds: {
    avg: number;
    totalVolume: number;
    percentiles: {
      top10: number;
      top25: number;
      bottom10: number;
    };
  };
  userUid?: string;
}

export class TransactionQueryEngine {
  static query<T extends NormalizedTransaction>(options: QueryEngineOptions<T>): T[] {
    const {
      normalized,
      filterCriteria,
      searchTerm,
      accounts,
      activeView,
      dimensionNodes,
      reverseDimensionIndex,
      thresholds,
      userUid
    } = options;

    const hasFilter = filterCriteria && Object.keys(filterCriteria).length > 0;
    
    // The search box, or a search set from elsewhere (the command palette's "show …")
    const effectiveSearchTerm = (searchTerm.trim() || filterCriteria?.searchTerm?.trim() || '');
    const hasSearch = effectiveSearchTerm.length > 0;
    
    const allowSimulations = Boolean(filterCriteria?.includeSimulations || activeView?.filter?.includeSimulations);
    if (!hasFilter && !hasSearch && !activeView) {
      return allowSimulations ? normalized : normalized.filter(t => !isSimulationTransaction(t as Transaction));
    }

    const lowerSearch = normalizeSearchText(effectiveSearchTerm).trim();
    // Fast path N-gram token search for single word queries
    if (lowerSearch && !lowerSearch.includes(':') && !Object.values(PATTERNS).some(pattern => pattern.test(lowerSearch)) && !/(?:^|\s)(?:-|not\s)/i.test(lowerSearch)) {
      const fastMatches = searchTransactions(normalized as Transaction[], lowerSearch);
      if (fastMatches.length > 0 && !hasFilter) {
        return fastMatches as T[];
      }
    }
    
    // Parse Key-Value directives, amount operators, temporal context, and free-text terms
    const keyValues: Record<string, string> = {};
    let queryText = lowerSearch;
    
    // Extract key:value filters (e.g., category:Meals, account:Checking, type:expense, status:pending, payee:Apple, is:pending, min:100, max:500)
    const kvRegex = /\b(category|account|project|type|status|class|location|payee|vendor|customer|tag|code|id|min|max|is):\s*("[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}_./-]+)/giu;
    let kvMatch;
    while ((kvMatch = kvRegex.exec(lowerSearch)) !== null) {
      const key = normalizeSearchText(kvMatch[1]);
      const val = normalizeSearchText(unquoteSearchValue(kvMatch[2]));
      keyValues[key] = val;
    }
    queryText = queryText.replace(kvRegex, ' ');

    // 1. Precise Amount Operators
    const opMatch = queryText.match(PATTERNS.OP);
    if (opMatch) queryText = queryText.replace(PATTERNS.OP, ' ');

    const textOpMatch = queryText.match(PATTERNS.TEXT_OP);
    if (textOpMatch) queryText = queryText.replace(PATTERNS.TEXT_OP, ' ');

    const rangeMatch = queryText.match(PATTERNS.RANGE);
    if (rangeMatch) queryText = queryText.replace(PATTERNS.RANGE, ' ');

    const percentileMatch = queryText.match(PATTERNS.PERCENTILE);
    if (percentileMatch) queryText = queryText.replace(PATTERNS.PERCENTILE, ' ');

    const averageMatch = queryText.match(PATTERNS.AVERAGE);
    if (averageMatch) queryText = queryText.replace(PATTERNS.AVERAGE, ' ');

    // 2. Temporal Context Parsers (Most specific first)
    const dateRangeMatch = queryText.match(PATTERNS.DATE_RANGE);
    if (dateRangeMatch) queryText = queryText.replace(PATTERNS.DATE_RANGE, ' ');

    const sinceDateMatch = queryText.match(PATTERNS.SINCE_DATE);
    if (sinceDateMatch) queryText = queryText.replace(PATTERNS.SINCE_DATE, ' ');

    const beforeDateMatch = queryText.match(PATTERNS.BEFORE_DATE);
    if (beforeDateMatch) queryText = queryText.replace(PATTERNS.BEFORE_DATE, ' ');

    const relativeTimeMatch = queryText.match(PATTERNS.RELATIVE);
    if (relativeTimeMatch) queryText = queryText.replace(PATTERNS.RELATIVE, ' ');

    const quarterMatch = queryText.match(PATTERNS.QUARTER);
    if (quarterMatch) queryText = queryText.replace(PATTERNS.QUARTER, ' ');

    const monthMatch = queryText.match(PATTERNS.MONTH);
    if (monthMatch) queryText = queryText.replace(PATTERNS.MONTH, ' ');

    const yearMatch = queryText.match(PATTERNS.YEAR);
    if (yearMatch) queryText = queryText.replace(PATTERNS.YEAR, ' ');

    // 3. Entity & Advanced String Tags
    const categoryMatch = queryText.match(PATTERNS.CATEGORY);
    if (categoryMatch) queryText = queryText.replace(PATTERNS.CATEGORY, ' ');

    const projectMatch = queryText.match(PATTERNS.PROJECT);
    if (projectMatch) queryText = queryText.replace(PATTERNS.PROJECT, ' ');

    const classMatch = queryText.match(PATTERNS.CLASS);
    if (classMatch) queryText = queryText.replace(PATTERNS.CLASS, ' ');

    const locationMatch = queryText.match(PATTERNS.LOCATION);
    if (locationMatch) queryText = queryText.replace(PATTERNS.LOCATION, ' ');

    const startsWithMatch = queryText.match(PATTERNS.STARTS_WITH);
    if (startsWithMatch) queryText = queryText.replace(PATTERNS.STARTS_WITH, ' ');

    const endsWithMatch = queryText.match(PATTERNS.ENDS_WITH);
    if (endsWithMatch) queryText = queryText.replace(PATTERNS.ENDS_WITH, ' ');

    const containsMatch = queryText.match(PATTERNS.CONTAINS);
    if (containsMatch) queryText = queryText.replace(PATTERNS.CONTAINS, ' ');

    const errorMatch = queryText.match(PATTERNS.ERROR);
    if (errorMatch) queryText = queryText.replace(PATTERNS.ERROR, ' ');

    // 4. Negative Terms (-term or NOT term)
    const negativeTerms: string[] = [];
    const negRegex = /(?:^|\s)-(?:"[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}_.-]+)|(?:^|\s)NOT\s+("[^"]*"|'[^']*'|[\p{L}\p{M}\p{N}_.-]+)/giu;
    let negMatch;
    while ((negMatch = negRegex.exec(queryText)) !== null) {
      const rawMatch = negMatch[0].trim();
      if (rawMatch.startsWith('-')) {
        negativeTerms.push(normalizeSearchText(unquoteSearchValue(rawMatch.substring(1))));
      } else if (negMatch[1]) {
        negativeTerms.push(normalizeSearchText(unquoteSearchValue(negMatch[1])));
      }
    }
    queryText = queryText.replace(negRegex, ' ');

    // 5. Remaining Free-Text Words
    const freeTextKeywords = normalizeSearchText(queryText)
      .split(/\s+/)
      .map((w: string) => w.trim())
      .filter((w: string) => w.length > 0 && w !== 'and' && w !== 'or');

    // 6. Entity Intent Resolver (Heuristic categorization without prefixes)
    const possibleEntityMatch = freeTextKeywords.length > 0 && !Object.values(PATTERNS).some(p => lowerSearch.match(p));
    const recognizedAccountNames = possibleEntityMatch ? accounts.filter((a) =>
      freeTextKeywords.some((kw: string) => normalizeSearchText((a.name || '')).includes(kw) || normalizeSearchText((a.category || '')).includes(kw)) ||
      freeTextKeywords.some((kw: string) => jaroWinklerSimilarity(kw, normalizeSearchText((a.name || ''))) > 0.88)
    ).map((a) => a.name) : [];
    
    // Convert to Set for O(1) lookup inside the 100k hot-loop
    const recognizedAccountNamesSet = new Set(recognizedAccountNames);
    const accountMap = new Set(accounts.map(a => a.id));
    
    // Dimension Node Intent Resolver
    const recognizedDimensionNodeIds = possibleEntityMatch ? dimensionNodes.filter((n) =>
      freeTextKeywords.some((kw: string) => normalizeSearchText((n.id || '')) === kw || normalizeSearchText((n.description || '')).includes(kw)) ||
      freeTextKeywords.some((kw: string) => n.aliases?.some((a: string) => normalizeSearchText(a).includes(kw))) ||
      freeTextKeywords.some((kw: string) => jaroWinklerSimilarity(kw, normalizeSearchText((n.description || ''))) > 0.88)
    ).map((n) => n.id) : [];
    
    // Pull directly from O(1) reverse index for dimension matches to avoid scanning dimensions in loop
    const matchedByDimensionTxIds = new Set<string>();
    if (recognizedDimensionNodeIds.length > 0) {
       recognizedDimensionNodeIds.forEach(nId => {
          const txs = reverseDimensionIndex.get(nId);
          if (txs) txs.forEach(tId => matchedByDimensionTxIds.add(tId));
       });
    }

    // Helper function to test keyword presence across all searchable transaction fields
    const checkKeywordMatch = (t: NormalizedTransaction, kw: string): boolean => {
      if (!kw) return true;
      if (normalizeSearchText((t.description || '')).includes(kw)) return true;
      if (normalizeSearchText(t._normalized?.sanitizedDescription).includes(kw)) return true;
      if (normalizeSearchText((t.payee || '')).includes(kw)) return true;
      if (normalizeSearchText((t.project || '')).includes(kw)) return true;
      if (normalizeSearchText((t.id || '')).includes(kw)) return true;
      if (normalizeSearchText((t.type || '')).includes(kw)) return true;
      if (normalizeSearchText((t.status || '')).includes(kw)) return true;
      if (t.tags && t.tags.some((tag: string) => normalizeSearchText(tag).includes(kw))) return true;

      if (t.lines) {
        for (const l of t.lines) {
          if (normalizeSearchText((l.description || '')).includes(kw)) return true;
          if (normalizeSearchText((l.accountName || '')).includes(kw)) return true;
          if (normalizeSearchText((l.memo || '')).includes(kw)) return true;
          if (normalizeSearchText((l.class || '')).includes(kw)) return true;
          if (normalizeSearchText((l.location || '')).includes(kw)) return true;
          if (l.tags && l.tags.some((tg: string) => normalizeSearchText(tg).includes(kw))) return true;
        }
      }

      const firstAccountId = t.lines?.[0]?.accountId;
      if (firstAccountId) {
        const acc = accounts.find(a => a.id === firstAccountId);
        if (acc) {
          if (normalizeSearchText((acc.name || '')).includes(kw)) return true;
          if (normalizeSearchText((acc.code || '')).includes(kw)) return true;
          if (normalizeSearchText((acc.category || '')).includes(kw)) return true;
        }
      }

      if (recognizedAccountNamesSet.has(t.lines?.[0]?.accountName || '') || matchedByDimensionTxIds.has(t.id)) {
        return true;
      }

      if (kw.length >= 3) {
        const similarity = jaroWinklerSimilarity(kw, normalizeSearchText((t.description || '')), userUid, t._normalized?.sanitizedDescription);
        if (similarity >= 0.85) return true;
      }

      return false;
    };

    // Intent Resolution & Sub-Hot-Loop Pre-computation (CRITICAL FOR PERFORMANCE AT 100k RECORDS)
    const opVal = opMatch ? { op: opMatch[1], val: TruthEngine.parseAmountToCents(opMatch[2]) / 100 } : null;
    let textOp = null;
    if (textOpMatch) {
      const phrase = textOpMatch[1];
      const val = TruthEngine.parseAmountToCents(textOpMatch[2]) / 100;
      if (phrase.includes('greater') || phrase.includes('more') || phrase.includes('over') || phrase.includes('above')) textOp = { op: '>', val };
      else if (phrase.includes('less') || phrase.includes('under') || phrase.includes('below')) textOp = { op: '<', val };
      else if (phrase.includes('least')) textOp = { op: '>=', val };
      else if (phrase.includes('most')) textOp = { op: '<=', val };
      else if (phrase.includes('around') || phrase.includes('about') || phrase.includes('approx')) textOp = { op: '~', val };
    }

    // Precalculate parsed parameters for Range Logic
    const rangeMin = rangeMatch ? TruthEngine.parseAmountToCents(rangeMatch[1]) / 100 : 0;
    const rangeMax = rangeMatch ? TruthEngine.parseAmountToCents(rangeMatch[2]) / 100 : 0;

    // Precalculate Month Logic
    const parsedMonthIdx = (() => {
      if (!monthMatch) return -1;
      const mNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      return mNames.indexOf(normalizeSearchText(monthMatch[1])) % 12;
    })();
    const parsedMonthStr = parsedMonthIdx !== -1 ? (parsedMonthIdx + 1).toString().padStart(2, '0') : '';

    // Precalculate Relative Date thresholds and state variables
    const parsedRelativeRel = relativeTimeMatch ? normalizeSearchText(relativeTimeMatch[1]) : '';
    const parsedNow = new Date();
    const parsedNowMonth = parsedNow.getMonth();
    const parsedNowYear = parsedNow.getFullYear();
    const parsedNowTime = parsedNow.getTime();
    const parsedTodayStr = format(parsedNow, 'yyyy-MM-dd');

    // Precalculate prefix filter parameters
    const queryStartsWith = startsWithMatch ? normalizeSearchText(unquoteSearchValue(startsWithMatch[1]).trim()) : '';
    const queryEndsWith = endsWithMatch ? normalizeSearchText(unquoteSearchValue(endsWithMatch[1]).trim()) : '';
    const queryContains = containsMatch ? normalizeSearchText(unquoteSearchValue(containsMatch[1]).trim()) : '';

    return normalized.filter(t => {
      // Identity Consistency Guard
      if (!t.id || !t._normalized) return false;

      // #100: Ghost / simulation / forecast isolation from normal queries unless explicitly requested
      const allowSimulations = Boolean(filterCriteria?.includeSimulations || activeView?.filter?.includeSimulations);
      if (!allowSimulations && isSimulationTransaction(t as Transaction)) {
        return false;
      }

      // Active View (Saved Search & Filters)
      if (activeView) {
        const vFilter = activeView.filter;
        
        if (vFilter.accountTypes && vFilter.accountTypes.length > 0) {
          const mainLineAccount = accounts.find(a => a.id === t.lines?.[0]?.accountId) || { type: 'expense' };
          if (!vFilter.accountTypes.includes(mainLineAccount.type)) return false;
        }
        
        if (vFilter.accountIds && vFilter.accountIds.length > 0) {
          if (!vFilter.accountIds.includes(t.lines?.[0]?.accountId || '')) return false;
        }
        
        if (vFilter.minAmountCents !== undefined && t.totalAmountCents < vFilter.minAmountCents) return false;
        if (vFilter.maxAmountCents !== undefined && t.totalAmountCents > vFilter.maxAmountCents) return false;
        if (vFilter.type && vFilter.type !== 'all' && t.type !== vFilter.type) return false;
        if (vFilter.status && vFilter.status !== 'all' && t.status !== vFilter.status) return false;
        if (vFilter.projectId && t.project !== vFilter.projectId) return false;

        // View-based OR search matching any word in view's searchTerm
        if (vFilter.searchTerm) {
          const viewWords = normalizeSearchText(vFilter.searchTerm).split(/\s+/).filter(Boolean);
          if (viewWords.length > 0) {
            const matchesAnyViewWord = viewWords.some((w: string) => checkKeywordMatch(t, w));
            if (!matchesAnyViewWord) return false;
          }
        }
      }

      // Filter Criteria (UI Overrides) - Optimized Procedural Filtering
      if (filterCriteria) {
        if ((filterCriteria.selectedCategories?.length ?? 0) > 0) {
          const account = resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName);
          if (!filterCriteria.selectedCategories?.includes(account || '')) return false;
        }
        if ((filterCriteria.selectedProjects?.length ?? 0) > 0) {
          if (!filterCriteria.selectedProjects?.includes(t.project || '')) return false;
        }
        if ((filterCriteria.selectedClasses?.length ?? 0) > 0) {
          const txClass = t.lines?.[0]?.class;
          if (!filterCriteria.selectedClasses?.includes(txClass || '')) return false;
        }
        if ((filterCriteria.selectedStatuses?.length ?? 0) > 0) {
          if (!filterCriteria.selectedStatuses?.includes(t.status || '')) return false;
        }
        if ((filterCriteria.selectedTypes?.length ?? 0) > 0) {
          if (!filterCriteria.selectedTypes?.includes(t.type || '')) return false;
        }

        const categoryName = resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName);
        if (filterCriteria.category && filterCriteria.category !== 'All' && categoryName !== filterCriteria.category) return false;
        if (filterCriteria.project && filterCriteria.project !== 'All' && t.project !== filterCriteria.project) return false;
        if (filterCriteria.type && filterCriteria.type !== 'All' && t.type !== filterCriteria.type) return false;
        
        if (!isTransactionInDateRange(t, filterCriteria.startDate, filterCriteria.endDate)) return false;
        if (filterCriteria.minAmount !== undefined && t._normalized.absAmount < filterCriteria.minAmount) return false;
        if (filterCriteria.maxAmount !== undefined && t._normalized.absAmount > filterCriteria.maxAmount) return false;

        // Class and Location arrays
        if (filterCriteria.selectedClasses && filterCriteria.selectedClasses.length > 0) {
          const match = t.lines?.some((l) => filterCriteria.selectedClasses?.includes(l.class || 'Unspecified'));
          if (!match) return false;
        }
        if (filterCriteria.selectedLocations && filterCriteria.selectedLocations.length > 0) {
          const match = t.lines?.some((l) => filterCriteria.selectedLocations?.includes(l.location || 'Unspecified'));
          if (!match) return false;
        }
      }

      // Smart Multi-Token Search Logic (Conjunctive & Precision Engine)
      if (hasSearch) {
        let isMatch = true;

        // A. Key-Value & Directive Filters (category, account, project, type, status, class, location, payee, vendor, tag, min, max, is)
        if (keyValues['category'] || keyValues['account']) {
          const target = keyValues['category'] || keyValues['account'];
          const catName = normalizeSearchText(resolveAccountName(accounts, t.lines?.[0]?.accountId, t.lines?.[0]?.accountName));
          const mainLineAcc = accounts.find(a => a.id === t.lines?.[0]?.accountId);
          const accName = normalizeSearchText((mainLineAcc?.name || ''));
          const accCode = normalizeSearchText((mainLineAcc?.code || ''));
          if (!catName.includes(target) && !accName.includes(target) && !accCode.includes(target)) {
            isMatch = false;
          }
        }

        if (isMatch && keyValues['project']) {
          const proj = normalizeSearchText((t.project || ''));
          if (!proj.includes(keyValues['project'])) isMatch = false;
        }

        if (isMatch && keyValues['type']) {
          const tType = normalizeSearchText((t.type || ''));
          if (tType !== keyValues['type']) isMatch = false;
        }

        if (isMatch && keyValues['status']) {
          const tStatus = normalizeSearchText((t.status || ''));
          if (tStatus !== keyValues['status']) isMatch = false;
        }

        if (isMatch && keyValues['class']) {
          const hasClass = t.lines?.some((l) => normalizeSearchText((l.class || '')).includes(keyValues['class']));
          if (!hasClass) isMatch = false;
        }

        if (isMatch && keyValues['location']) {
          const hasLoc = t.lines?.some((l) => normalizeSearchText((l.location || '')).includes(keyValues['location']));
          if (!hasLoc) isMatch = false;
        }

        if (isMatch && (keyValues['payee'] || keyValues['vendor'] || keyValues['customer'])) {
          const targetPayee = keyValues['payee'] || keyValues['vendor'] || keyValues['customer'];
          const p = normalizeSearchText((t.payee || ''));
          if (!p.includes(targetPayee)) isMatch = false;
        }

        if (isMatch && keyValues['tag']) {
          const targetTag = keyValues['tag'];
          const hasTag = (t.tags && t.tags.some((tg: string) => normalizeSearchText(tg).includes(targetTag))) ||
            t.lines?.some((l) => l.tags && l.tags.some((tg: string) => normalizeSearchText(tg).includes(targetTag)));
          if (!hasTag) isMatch = false;
        }

        if (isMatch && keyValues['code']) {
          const targetCode = keyValues['code'];
          const mainLineAcc = accounts.find(a => a.id === t.lines?.[0]?.accountId);
          if (normalizeSearchText(mainLineAcc?.code) !== targetCode && !(t.lines || []).some((l) => normalizeSearchText(l.accountId).includes(targetCode))) {
            isMatch = false;
          }
        }

        if (isMatch && keyValues['id']) {
          if (!normalizeSearchText(t.id).includes(keyValues['id'])) isMatch = false;
        }

        if (isMatch && keyValues['min']) {
          const minVal = Number.parseFloat(keyValues['min']);
          if (!Number.isNaN(minVal) && t._normalized.absAmount < minVal) isMatch = false;
        }

        if (isMatch && keyValues['max']) {
          const maxVal = Number.parseFloat(keyValues['max']);
          if (!Number.isNaN(maxVal) && t._normalized.absAmount > maxVal) isMatch = false;
        }

        // Boolean 'is:' directives
        if (isMatch && keyValues['is']) {
          const isDirective = keyValues['is'];
          if (isDirective === 'pending' && t.status !== 'pending') isMatch = false;
          else if (isDirective === 'posted' && t.status !== 'completed' && (t.status as string) !== 'posted') isMatch = false;
          else if (isDirective === 'cleared' && !t.isCleared) isMatch = false;
          else if (isDirective === 'reconciled' && t.status !== 'reconciled' && !t.isCleared) isMatch = false;
          else if (isDirective === 'unbalanced') {
            const isUnbalanced = LedgerEngine.auditTransaction(t as Transaction, accountMap).some((err: string) => normalizeSearchText(err).includes('unbalanced') || normalizeSearchText(err).includes('imbalance'));
            if (!isUnbalanced) isMatch = false;
          }
          else if (isDirective === 'error') {
            const auditErrors = LedgerEngine.auditTransaction(t as Transaction, accountMap);
            if (auditErrors.length === 0) isMatch = false;
          }
          else if (isDirective === 'ghost' || isDirective === 'forecast') {
            if (t.type !== 'forecast' && !t.metadata?.isGhost) isMatch = false;
          }
          else if (isDirective === 'split') {
            if (!t.lines || t.lines.length <= 2) isMatch = false;
          }
        }

        // B. Amount Heuristics
        if (isMatch && opVal) {
          const amt = t._normalized.absAmount;
          if (opVal.op === '>' && !(amt > opVal.val)) isMatch = false;
          else if (opVal.op === '>=' && !(amt >= opVal.val)) isMatch = false;
          else if (opVal.op === '<' && !(amt < opVal.val)) isMatch = false;
          else if (opVal.op === '<=' && !(amt <= opVal.val)) isMatch = false;
          else if (opVal.op === '=' && !(Math.abs(amt - opVal.val) < 0.01)) isMatch = false;
        } 
        else if (isMatch && textOp) {
          const actualAmt = t._normalized.absAmount;
          if (textOp.op === '>') { if (!(actualAmt > textOp.val)) isMatch = false; }
          else if (textOp.op === '>=') { if (!(actualAmt >= textOp.val)) isMatch = false; }
          else if (textOp.op === '<') { if (!(actualAmt < textOp.val)) isMatch = false; }
          else if (textOp.op === '<=') { if (!(actualAmt <= textOp.val)) isMatch = false; }
          else if (textOp.op === '~') { if (!(actualAmt >= textOp.val * 0.9 && actualAmt <= textOp.val * 1.1)) isMatch = false; }
        }
        else if (isMatch && rangeMatch) {
          const amt = t._normalized.absAmount;
          if (amt < rangeMin || amt > rangeMax) isMatch = false;
        }

        // C. Statistical Anchors
        if (isMatch && averageMatch) {
          const rel = normalizeSearchText(averageMatch[1]);
          if (rel === 'above' && t._normalized.absAmount <= thresholds.avg) isMatch = false;
          if (rel === 'below' && t._normalized.absAmount >= thresholds.avg) isMatch = false;
        }
        if (isMatch && percentileMatch) {
          const side = normalizeSearchText(percentileMatch[1]);
          const pct = percentileMatch[2];
          const amt = t._normalized.absAmount;
          if (side === 'top') {
            const threshold = pct === '10' ? thresholds.percentiles.top10 : pct === '25' ? thresholds.percentiles.top25 : (thresholds.percentiles.top25 * 0.5);
            if (amt < threshold) isMatch = false;
          } else if (side === 'bottom') {
            const threshold = pct === '10' ? thresholds.percentiles.bottom10 : pct === '25' ? (thresholds.percentiles.bottom10 * 2) : (thresholds.percentiles.bottom10 * 3);
            if (amt > threshold) isMatch = false;
          }
        }

        // D. Temporal Vectoring
        if (isMatch && monthMatch) {
          if (!(t.date || '').includes(`-${parsedMonthStr}-`)) isMatch = false;
        }
        if (isMatch && yearMatch) {
          if (!(t.date || '').startsWith(yearMatch[1])) isMatch = false;
        }
        if (isMatch && relativeTimeMatch) {
          const tDateStr = t.date || '';
          if (parsedRelativeRel === 'this month') {
             const tYear = Number.parseInt(tDateStr.substring(0, 4), 10);
             const tMonth = Number.parseInt(tDateStr.substring(5, 7), 10) - 1;
             if (tMonth !== parsedNowMonth || tYear !== parsedNowYear) isMatch = false;
          } else if (parsedRelativeRel === 'last month') {
             const lm = parsedNowMonth === 0 ? 11 : parsedNowMonth - 1;
             const lmy = parsedNowMonth === 0 ? parsedNowYear - 1 : parsedNowYear;
             const tYear = Number.parseInt(tDateStr.substring(0, 4), 10);
             const tMonth = Number.parseInt(tDateStr.substring(5, 7), 10) - 1;
             if (tMonth !== lm || tYear !== lmy) isMatch = false;
          } else if (parsedRelativeRel === 'this year') {
             const tYear = Number.parseInt(tDateStr.substring(0, 4), 10);
             if (tYear !== parsedNowYear) isMatch = false;
          } else if (parsedRelativeRel === 'last year') {
             const tYear = Number.parseInt(tDateStr.substring(0, 4), 10);
             if (tYear !== parsedNowYear - 1) isMatch = false;
          } else if (parsedRelativeRel === 'last 30 days') {
             const tTime = parseLocalDate(tDateStr).getTime();
             const diffDays = Math.floor((parsedNowTime - tTime) / (1000 * 60 * 60 * 24));
             if (diffDays < 0 || diffDays > 30) isMatch = false;
          } else if (parsedRelativeRel === 'last 7 days') {
             const tTime = parseLocalDate(tDateStr).getTime();
             const diffDays = Math.floor((parsedNowTime - tTime) / (1000 * 60 * 60 * 24));
             if (diffDays < 0 || diffDays > 7) isMatch = false;
          } else if (parsedRelativeRel === 'yesterday') {
             const yesterday = new Date(parsedNow);
             yesterday.setDate(yesterday.getDate() - 1);
             if (tDateStr !== format(yesterday, 'yyyy-MM-dd')) isMatch = false;
          } else if (parsedRelativeRel === 'this week') {
             const tDateObj = parseLocalDate(tDateStr);
             const dayOfWeek = parsedNow.getDay() || 7;
             const startOfWeek = new Date(parsedNow);
             startOfWeek.setDate(parsedNow.getDate() - dayOfWeek + 1);
             startOfWeek.setHours(0,0,0,0);
             if (tDateObj < startOfWeek || tDateObj > parsedNow) isMatch = false;
          } else if (parsedRelativeRel === 'last week') {
             const tDateObj = parseLocalDate(tDateStr);
             const dayOfWeek = parsedNow.getDay() || 7;
             const startOfThisWeek = new Date(parsedNow);
             startOfThisWeek.setDate(parsedNow.getDate() - dayOfWeek + 1);
             startOfThisWeek.setHours(0,0,0,0);
             const startOfLastWeek = new Date(startOfThisWeek);
             startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
             if (tDateObj < startOfLastWeek || tDateObj >= startOfThisWeek) isMatch = false;
          } else if (parsedRelativeRel === 'ytd') {
             const tYear = Number.parseInt(tDateStr.substring(0, 4), 10);
             const tDateObj = parseLocalDate(tDateStr);
             if (tYear !== parsedNowYear || tDateObj > parsedNow) isMatch = false;
          } else if (parsedRelativeRel === 'today') {
             if (tDateStr !== parsedTodayStr) isMatch = false;
          }
        }
        if (isMatch && quarterMatch) {
          const q = normalizeSearchText(quarterMatch[1]);
          const tDateStr = t.date || '';
          const tMonth = Number.parseInt(tDateStr.substring(5, 7), 10) - 1;
          if (q === 'q1' && tMonth > 2) isMatch = false;
          else if (q === 'q2' && (tMonth < 3 || tMonth > 5)) isMatch = false;
          else if (q === 'q3' && (tMonth < 6 || tMonth > 8)) isMatch = false;
          else if (q === 'q4' && tMonth < 9) isMatch = false;
        }
        if (isMatch && dateRangeMatch) {
          const start = dateRangeMatch[1];
          const end = dateRangeMatch[2];
          if (!isTransactionInDateRange(t, start, end)) isMatch = false;
        }
        if (isMatch && sinceDateMatch) {
          const start = sinceDateMatch[2];
          if (!isTransactionInDateRange(t, start, undefined)) isMatch = false;
        }
        if (isMatch && beforeDateMatch) {
          const end = beforeDateMatch[2];
          if (!isTransactionInDateRange(t, undefined, end)) isMatch = false;
        }

        // E. String Directives
        if (isMatch && startsWithMatch) {
            if (!normalizeSearchText((t.description || '')).startsWith(queryStartsWith)) isMatch = false;
        }
        if (isMatch && endsWithMatch) {
            if (!normalizeSearchText((t.description || '')).endsWith(queryEndsWith)) isMatch = false;
        }
        if (isMatch && containsMatch) {
            if (!normalizeSearchText((t.description || '')).includes(queryContains)) isMatch = false;
        }
        if (isMatch && errorMatch) {
           const auditErrors = LedgerEngine.auditTransaction(t as Transaction, accountMap);
           if (auditErrors.length === 0) isMatch = false;
        }

        // F. Negative Terms (-term or NOT term)
        if (isMatch && negativeTerms.length > 0) {
          for (const negKw of negativeTerms) {
            if (checkKeywordMatch(t, negKw)) {
              isMatch = false;
              break;
            }
          }
        }

        // G. Free-Text Keywords (All must match)
        if (isMatch && freeTextKeywords.length > 0) {
          for (const kw of freeTextKeywords) {
            if (!checkKeywordMatch(t, kw)) {
              isMatch = false;
              break;
            }
          }
        }

        return isMatch;
      }

      return true;
    });
  }
}
