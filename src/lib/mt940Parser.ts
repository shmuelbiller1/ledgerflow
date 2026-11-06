import { parseAmountToCents } from './utils';
import { bankStatementDate } from './bankStatementDate';
export interface ParsedBankLine {
  date: string;
  amountCents: number;
  description: string;
  reference?: string;
  type: 'debit' | 'credit';
}

/**
 * Parsers for SWIFT MT940 bank statement format.
 */
export function parseMT940Statement(rawContent: string): ParsedBankLine[] {
  const lines = rawContent.split(/\r?\n/);
  const parsedLines: ParsedBankLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Tag :61: Statement Line
    // Format: :61:YYMMDD[MMDD]C/D[F]AmountN...
    if (trimmed.startsWith(':61:')) {
      const data = trimmed.substring(4);
      const dateRaw = data.substring(0, 6); // YYMMDD
      const year = 2000 + Number(dateRaw.substring(0, 2));
      const month = Number(dateRaw.substring(2, 4));
      const day = Number(dateRaw.substring(4, 6));
      // F-37 fuzzing found `:61:` lines with non-calendar dates (e.g. "991332" → 2099-13-32).
      // A statement line is only usable when its date is a real calendar day; refuse the file
      // with a plain-word reason instead of importing an impossible date.
      const currentDate = /^\d{6}$/.test(dateRaw) ? bankStatementDate(year, month, day) : null;
      if (!currentDate) throw new Error(`MT940: the statement line date "${dateRaw}" is not a real calendar date (expected YYMMDD).`);

      // Indicator in :61: comes after date (6 or 10 digits YYMMDD or YYMMDDMMDD)
      const afterDate = data.substring(6);
      const isCredit = afterDate.startsWith('C') || afterDate.startsWith('RC') || afterDate.substring(4).startsWith('C');
      const indicator = isCredit ? 'credit' : 'debit';

      // Extract amount
      const amountMatch = data.match(/([0-9]+[,.][0-9]{2})/);
      const amountCents = amountMatch
        ? parseAmountToCents(amountMatch[1].replace(',', '.'))
        : 0;
      if (!Number.isSafeInteger(amountCents)) throw new Error(`MT940: the amount on the line dated ${currentDate} is outside the supported whole-cent range.`);

      const signedAmountCents = indicator === 'debit' ? -amountCents : amountCents;

      parsedLines.push({
        date: currentDate,
        amountCents: signedAmountCents,
        description: `MT940 Entry ${parsedLines.length + 1}`,
        type: indicator
      });
    } else if (trimmed.startsWith(':86:') && parsedLines.length > 0) {
      // Information to Account Owner
      parsedLines[parsedLines.length - 1].description = trimmed.substring(4).trim();
    }
  }

  return parsedLines;
}
