import { bankStatementDate } from './bankStatementDate';

export interface ParsedBankLine {
  date: string;
  amountCents: number;
  type: 'debit' | 'credit';
  description: string;
  reference?: string;
}

export type MT940ParsedLine = ParsedBankLine;

/**
 * SWIFT MT940 `:61:` remainder after the 6-digit `YYMMDD` value date:
 *  - optional 4-digit `MMDD` entry date
 *  - Debit/Credit mark: `C`, `D`, `RC` (reversal of credit -> debit), `RD` (reversal of debit -> credit)
 *  - optional 1-letter SWIFT funds code (3rd letter of ISO currency code)
 *  - amount with `,` or `.` decimal separator (0–3 fractional digits, e.g. `500,`, `500,00`, `125.5`)
 *  - 4-char SWIFT transaction type code (`S`/`N`/`F` + 3 alphanumerics) and optional customer reference (`//bankref` ignored)
 */
const MT940_TAIL = /^(\d{4})?(R[CD]|[CD])([A-Z])?(\d{1,16})(?:[,.](\d{0,3}))?(?:([SNF][A-Z0-9]{3})([^\r\n/]{0,16}))?/;

export function parseMT940Statement(content: string): ParsedBankLine[] {
  const lines: ParsedBankLine[] = [];
  const blocks = content.replace(/\r\n/g, '\n').split(/\n(?=:)/);

  let pendingTx: Partial<ParsedBankLine> | null = null;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.startsWith(':61:')) {
      if (pendingTx && pendingTx.date && pendingTx.amountCents !== undefined) {
        lines.push({
          date: pendingTx.date,
          amountCents: pendingTx.amountCents,
          type: pendingTx.type || 'debit',
          description: pendingTx.description || 'MT940 Bank Transaction',
          reference: pendingTx.reference,
        });
      }

      const raw = trimmed.substring(4).trim();
      const valDate = raw.slice(0, 6);
      if (!/^\d{6}$/.test(valDate)) {
        pendingTx = null;
        continue;
      }

      const yy = Number.parseInt(valDate.substring(0, 2), 10);
      const year = yy > 70 ? 1900 + yy : 2000 + yy;
      const month = Number.parseInt(valDate.substring(2, 4), 10);
      const day = Number.parseInt(valDate.substring(4, 6), 10);
      const dateStr = bankStatementDate(year, month, day);
      if (!dateStr) {
        throw new Error(`MT940 statement line has an invalid value date ("${valDate}" is not a real calendar date).`);
      }

      const tailMatch = MT940_TAIL.exec(raw.slice(6));
      if (!tailMatch) {
        pendingTx = null;
        continue;
      }

      const entryMmDd = tailMatch[1];
      if (entryMmDd) {
        const entryMonth = Number.parseInt(entryMmDd.slice(0, 2), 10);
        const entryDay = Number.parseInt(entryMmDd.slice(2, 4), 10);
        // Reject impossible MMDD entry dates such as 1345 (allow 0229 across year boundaries)
        const refYear = entryMonth === 2 && entryDay === 29 ? 2024 : year;
        if (!bankStatementDate(refYear, entryMonth, entryDay)) {
          throw new Error(`MT940 statement line has an invalid entry date ("${entryMmDd}" is not a real calendar day).`);
        }
      }

      const dcMark = tailMatch[2];
      // SWIFT ISO 15022: C = credit (+), D = debit (-), RC = reversal of credit (-), RD = reversal of debit (+)
      const isCredit = dcMark === 'C' || dcMark === 'RD';

      const wholeStr = tailMatch[4];
      const fracRaw = tailMatch[5] ?? '';
      // Convert major + fractional units to rounded integer cents without binary floating-point drift
      const paddedFrac = fracRaw.padEnd(3, '0');
      const twoDecimals = Number.parseInt(paddedFrac.slice(0, 2), 10);
      const thirdDigit = Number.parseInt(paddedFrac[2], 10);
      const wholeUnits = Number.parseInt(wholeStr, 10);
      if (!Number.isSafeInteger(wholeUnits) || wholeUnits > Math.floor((Number.MAX_SAFE_INTEGER - 100) / 100)) {
        throw new Error('MT940 statement line has an out-of-range amount.');
      }
      const rawCents = wholeUnits * 100 + twoDecimals + (thirdDigit >= 5 ? 1 : 0);
      if (!Number.isSafeInteger(rawCents)) {
        throw new Error('MT940 statement line has an out-of-range amount.');
      }

      const customerRef = tailMatch[7]?.trim();
      pendingTx = {
        date: dateStr,
        amountCents: isCredit ? rawCents : -rawCents,
        type: isCredit ? 'credit' : 'debit',
        description: 'MT940 Transaction',
        ...(customerRef && customerRef !== 'NONREF' ? { reference: customerRef } : {}),
      };
    } else if (trimmed.startsWith(':86:') && pendingTx) {
      const desc = trimmed.substring(4).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (desc) {
        pendingTx.description = desc;
      }
    }
  }

  if (pendingTx && pendingTx.date && pendingTx.amountCents !== undefined) {
    lines.push({
      date: pendingTx.date,
      amountCents: pendingTx.amountCents,
      type: pendingTx.type || 'debit',
      description: pendingTx.description || 'MT940 Bank Transaction',
      reference: pendingTx.reference,
    });
  }

  return lines;
}
