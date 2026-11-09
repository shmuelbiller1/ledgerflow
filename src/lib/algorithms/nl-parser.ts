import { parseAmountToCents } from '../utils';
import { unquoteSearchValue } from '../textNormalization';
import { AlgorithmDefinition } from './types';
import { addToDateISO, getLocalDateISO } from '../utils';
import { firstAmountText, restAfterCommandWord } from '../textShape';

export interface ParsedCommandIntent {
  type: 'transaction' | 'project' | 'query' | 'unknown';
  action?: 'expense' | 'revenue';
  amountCents?: number;
  description?: string;
  payee?: string;
  method?: string;
  dateStr?: string;
  projectName?: string;
  queryText?: string;
  displaySummary: string;
}

// Deterministic PEG-lite parsing for natural language entries and commands
export function parseNaturalLanguageEntry(text: string): ParsedCommandIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  
  if (!trimmed) {
    return { type: 'unknown', displaySummary: '' };
  }

  // 1. Check for Project Creation intent: "new project: Shakespeare Folio", "new book project Aspen"
  const projectMatch = trimmed.match(/^(?:new\s+)?(?:book\s+|realestate\s+|property\s+)?project\s*[:\s]\s*(.+)$/i);
  if (projectMatch && projectMatch[1]) {
    const projectName = projectMatch[1].trim();
    return {
      type: 'project',
      projectName,
      displaySummary: `Create Project: "${projectName}"`
    };
  }

  // 2. Check for Query/Report intent: "show maui repairs", "report q3 revenue"
  const queryText = restAfterCommandWord(trimmed, ['show', 'find', 'query', 'report']);
  if (queryText && !/\$\d+|\bpaid\b|\bearned\b/.test(lower)) {
    return {
      type: 'query',
      queryText: queryText.trim(),
      displaySummary: `Query Ledger for: "${queryText.trim()}"`
    };
  }

  // 3. Check for Transaction intent: if contains currency symbol or numbers with financial verbs/keywords
  const hasAmount = /\$|\b\d+(?:\.\d{1,2})?\b/.test(lower);
  const hasFinancialKeywords = /(paid|spent|bought|earned|got|received|sold|cash|chase|card|check|gas|rent|lunch|coffee|cab|uber|hotel|groceries|salary|client|fee|invoice)/.test(lower);

  if (hasAmount || hasFinancialKeywords) {
    let action: 'expense' | 'revenue' = 'expense';
    let amountCents = 0;
    let method = 'Cash';
    let dateStr = getLocalDateISO();
    let payee = '';

    // Action detection
    if (/(earned|received|got|sold|deposit|revenue|income)/.test(lower)) {
      action = 'revenue';
    }

    // Amount extraction
    const amtMatch = firstAmountText(lower);
    if (amtMatch !== undefined) {
      amountCents = parseAmountToCents(amtMatch);
    }

    // Payment method
    if (/(cash)/.test(lower)) method = 'Cash';
    else if (/(chase|card|credit|visa|mastercard|amex)/.test(lower)) method = 'Credit Card';
    else if (/(check|cheque|bank|wire|transfer)/.test(lower)) method = 'Checking Account';

    // Date
    if (/(yesterday)/.test(lower)) {
      dateStr = addToDateISO(getLocalDateISO(), { days: -1 });
    }

    // Payee extraction e.g. "paid Maria 150", "paid $100 to Starbucks"
    const payeeMatch = trimmed.match(/(?:paid|to|from|vendor)\s+("[^"]+"|'[^']+'|[A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)?|[\p{Script=Hebrew}\p{M}]+(?:\s+[\p{L}\p{M}]+)?)/u);
    if (payeeMatch && payeeMatch[1]) {
      payee = unquoteSearchValue(payeeMatch[1]).trim();
    }

    // Description extraction
    const stopWords = ['paid', 'spent', 'bought', 'earned', 'received', 'got', 'sold', 'cash', 'card', 'chase', 'credit', 'check', 'yesterday', 'today', 'for', 'on', 'to', 'from', payee.toLowerCase()].filter(Boolean);
    const words = trimmed.split(/\s+/).filter(w => !stopWords.includes(w.toLowerCase()) && !w.startsWith('$') && !/^\d+(?:\.\d+)?$/.test(w));
    const description = words.join(' ') || (action === 'revenue' ? 'Income Event' : 'Expense Event');

    const formattedAmount = (amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    const summary = `${action === 'revenue' ? 'Record Revenue' : 'Record Expense'}: ${formattedAmount} for "${description}"${payee ? ` (${payee})` : ''} via ${method}`;

    return {
      type: 'transaction',
      action,
      amountCents,
      description,
      payee,
      method,
      dateStr,
      displaySummary: summary
    };
  }

  return { type: 'unknown', displaySummary: '' };
}

export const NL_PARSER_ALGO: AlgorithmDefinition = {
  id: 'nl_parser',
  domain: 'system',
  name: 'Deterministic NL Entry Grammar',
  description: 'Parses natural sentences like "paid $40 gas cash yesterday" or "new project: Aspen" using PEG-lite regex slots.',
  inputs: [],
  compute: (_ctx, _inputs) => {
    const start = performance.now();
    const sample = "paid $40 gas cash yesterday";
    const result = parseNaturalLanguageEntry(sample);
    const ms = performance.now() - start;

    return {
      metrics: [
        { label: 'Sample Input', value: `"${sample}"` },
        { label: 'Parsed Intent', value: result.type },
        { label: 'Amount Parsed', value: `$${((result.amountCents || 0)/100).toFixed(2)}` },
        { label: 'Category/Desc', value: result.description || 'Unknown' },
        { label: 'Execution Time', value: `${ms.toFixed(2)} ms` }
      ],
      charts: [],
      insights: [
        `Parsed successfully using deterministic grammar in ${ms.toFixed(2)}ms.`,
        `Summary: ${result.displaySummary}`,
        'PEG-lite grammar executes instantly and local-first with zero API latency.'
      ]
    };
  }
};

