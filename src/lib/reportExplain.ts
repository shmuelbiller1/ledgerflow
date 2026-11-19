/**
 * The one description of the server's "explain this figure" answer (`POST /api/v1/reports/explain`,
 * src/server/reports/explain.ts), shared by the statement drill-down and R-7's change panel.
 *
 * Why it is a module rather than a type inside the dialog: two screens now ask the same question —
 * "which posted lines make up this figure" — and the answer's shape, the request body and the check
 * that the answer really is lines belong in one place. Two copies of that contract is how the
 * request and the reader drift apart.
 *
 * A request is always in *the report's* sign: `sign` says how the report prints the figure, and the
 * lines come back with their own amounts, so a caller multiplies by `sign` to show what the reader
 * sees.
 */
/** N-12: the filter that made a report figure. The lines come back from the full history. */
export interface ExplainRequest {
  accountIds: string[];
  /** none = a balance "as of" the end date, from the opening balance */
  startDate?: string;
  endDate?: string;
  /** the figure the report shows, in the report's sign */
  expectedCents?: number;
  /** -1 where the report shows credits as positive (income, liabilities, equity) */
  sign?: 1 | -1;
  /** how the report names the filter, e.g. "1 Mar – 31 Mar 2026" */
  label?: string;
  /** CB-25: only lines with this value of a label ("Unassigned": lines without one) */
  labelFilter?: { dimensionId: string; value: string };
}

/** One posted line behind a figure. */
export interface ExplainLine {
  key: string;
  transactionId: string | null;
  date: string;
  description: string;
  payee?: string;
  accountName: string;
  amountCents: number;
  document: { type: 'invoice' | 'bill' | 'transaction'; id: string } | null;
  bankMatched: boolean;
  attachments: number;
  opening?: boolean;
}

/** The server's answer: the lines, what they add up to, and how many entries they come from. */
export interface Explanation {
  lines: ExplainLine[];
  totalCents: number;
  entries: number;
}

/**
 * The body of the explain request. It is sent as text, not as a JSON-encoded value: the request is
 * its own key (the dialog's effect depends on it), and a total over a large chart of accounts is
 * too long for a query string.
 */
export function buildExplainBody(
  workspaceId: string,
  request: Pick<ExplainRequest, 'accountIds' | 'startDate' | 'endDate' | 'labelFilter'>,
): string {
  return JSON.stringify({
    workspaceId,
    accountIds: request.accountIds,
    ...(request.startDate ? { startDate: request.startDate } : {}),
    ...(request.endDate ? { endDate: request.endDate } : {}),
    ...(request.labelFilter
      ? { labelDimension: request.labelFilter.dimensionId, labelValue: request.labelFilter.value }
      : {}),
  });
}

/**
 * The answer, or an error. A body without a `lines` array is not an explanation — an error page, a
 * refused request, an older server — and saying so is better than rendering an empty list that
 * looks like "nothing here".
 */
export function parseExplanation(payload: Partial<Explanation> | null | undefined): Explanation {
  if (!payload || !Array.isArray(payload.lines)) throw new Error('The entries could not be loaded');
  return {
    lines: payload.lines,
    totalCents: Number(payload.totalCents) || 0,
    entries: Number(payload.entries) || payload.lines.length,
  };
}
