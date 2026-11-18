import React, { useMemo, useState } from 'react';
import { IBAN_COUNTRY_SPECS, ibanLengthFor, ibanProblem, ibanValidCountry } from '../../lib/banking/ibanCountrySpecs';
import { validRouting } from '../../lib/nacha';
import { downloadCsv } from '../../lib/csvExport';
import ReportTableScroll from './ReportTableScroll';
import { RowTable } from '../ui/RowTable';

const IBAN_CSV = ['Country', 'Country name', 'IBAN length', 'Source'];
const ibanRows = IBAN_COUNTRY_SPECS.map(r => [r.country, r.countryName, String(r.length), r.source.url]);

/**
 * A-139: US routing checksum and IBAN per-country validator (calculation status).
 * Read-only reference + live checker; nothing posts or moves money.
 */
export default function BankingValidationReportView() {
  const [iban, setIban] = useState('GB82 WEST 1234 5698 7654 32');
  const [routing, setRouting] = useState('021000021');
  const ibanResult = useMemo(() => {
    const v = iban.trim();
    if (!v) return { text: '', ok: null as boolean | null, len: undefined as number | undefined, prob: null as string | null };
    const prob = ibanProblem(v);
    const ok = ibanValidCountry(v);
    return { text: v, ok, len: v.replace(/[\s-]/g, '').length, prob };
  }, [iban]);
  const routingOk = useMemo(() => routing.trim() ? validRouting(routing.trim()) : null, [routing]);
  const expectedLen = ibanLengthFor(iban.replace(/[\s-]/g, '').slice(0,2).toUpperCase());

  return (
    <section aria-label="Banking validation" className="p-4 space-y-6 min-w-0">
      <h2>Banking data validation (US routing · IBAN)</h2>
      <p className="text-sm text-[var(--muted)]">
        Check a US routing number (9 digits, weighted checksum) and an IBAN (country length + mod-97 check digits).
        This is a data-quality check only — calculation status — not a bank confirmation, and it never posts or moves money.
        IBAN lengths are from the <a className="underline" href="https://www.swift.com/about-us/legal/compliance-0/iban-registry">SWIFT IBAN Registry</a> (ISO 13616).
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3 p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <h3 className="font-semibold">Check an IBAN</h3>
          <label className="flex flex-col gap-1 text-sm">IBAN
            <input aria-label="IBAN" value={iban} onChange={e => setIban(e.target.value)} placeholder="IL17 0108 0000 0001 2345 678"
              className="min-h-11 border rounded px-3 bg-[var(--surface)] font-mono" />
          </label>
          {iban.trim() && (
            <div className="text-sm space-y-1">
              <p>Country: <b>{iban.slice(0,2).toUpperCase() || '—'}</b> · Expected length: <b>{expectedLen ?? 'unknown country'}</b> · Typed: <b>{ibanResult.len}</b></p>
              {ibanResult.ok === true && <p role="status" className="text-emerald-700">✓ Valid: length and check digits match.</p>}
              {ibanResult.ok === false && <p role="alert" className="text-amber-700">✗ {ibanResult.prob}</p>}
              <p className="text-xs text-[var(--muted)]">Examples: IL 23 (Israel), DE 22, GB 22, FR 27, IT 27, SA 24. US does not use IBAN.</p>
            </div>
          )}
        </div>

        <div className="space-y-3 p-4 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          <h3 className="font-semibold">Check a US routing number</h3>
          <label className="flex flex-col gap-1 text-sm">Routing number
            <input aria-label="Routing number" value={routing} onChange={e => setRouting(e.target.value)} placeholder="021000021"
              inputMode="numeric" className="min-h-11 border rounded px-3 bg-[var(--surface)] font-mono" />
          </label>
          {routing.trim() && (
            <div className="text-sm">
              {routingOk === true && <p role="status" className="text-emerald-700">✓ Valid: 9 digits and checksum passes (3·(d0+d3+d6)+7·(d1+d4+d7)+(d2+d5+d8) ≡ 0 mod 10).</p>}
              {routingOk === false && <p role="alert" className="text-amber-700">✗ Invalid: must be 9 digits with a valid check digit.</p>}
              <p className="text-xs text-[var(--muted)] mt-2">Examples: 021000021 (Chase), 011000015 (Federal Reserve). Routing numbers identify US banks for ACH/wires.</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button type="button" className="min-h-11 px-4 rounded border border-[var(--line)]" onClick={() => downloadCsv('iban-country-lengths', IBAN_CSV, ibanRows)}>Export IBAN lengths CSV</button>
      </div>

      <ReportTableScroll>
        <RowTable
          rowHeaderColumn={false}
          rowClassName="border-b border-[var(--line)]/50"
          caption={(<>IBAN lengths per country (SWIFT IBAN Registry, ISO 13616)</>)}
          rows={IBAN_COUNTRY_SPECS}
          rowKey={r => r.country}
          captionClassName="text-left font-semibold pb-1"
          tableClassName="w-full text-sm"
          headRowClassName="border-b border-[var(--line)] text-xs text-[var(--muted)]"
          bodyClassName=""
          columns={[
            { header: "Country", className: "py-1 px-2 font-mono", headClassName: "text-left py-1 px-2", cell: (r) => r.country },
            { header: "Country name", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => r.countryName },
            { header: "Length", className: "py-1 px-2 tabular-nums", headClassName: "text-left py-1 px-2", cell: (r) => r.length },
            { header: "Source", className: "py-1 px-2", headClassName: "text-left py-1 px-2", cell: (r) => (<><a className="underline break-all" href={r.source.url}>{r.source.authority}</a> · {r.source.retrieved}</>) },
          ]}
        />
      </ReportTableScroll>
      <p className="text-xs text-[var(--muted)]">US routing checksum: (3·(d0+d3+d6)+7·(d1+d4+d7)+(d2+d5+d8)) mod 10 = 0. IBAN check: mod-97 = 1 (ISO 7064). This table is for data quality; it does not guarantee an account exists or that a bank will accept the IBAN.</p>
    </section>
  );
}
