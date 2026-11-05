import React from 'react';
import { formatCurrency } from '../../lib/utils';
import { useServerTagBreakdown } from '../../hooks/useServerTagBreakdown';
import { RangeReportSourceNote } from './RangeReportSourceNote';
import { Tag, Hash } from 'lucide-react';

interface Props {
  selectedYear?: number;
  startDate?: string;
  endDate?: string;
}

export const TagBreakdownReportView: React.FC<Props> = ({
  selectedYear,
  startDate,
  endDate
}) => {
  const start = startDate || (selectedYear ? `${selectedYear}-01-01` : undefined);
  const end = endDate || (selectedYear ? `${selectedYear}-12-31` : undefined);

  // L-123 step 4g: with the loaded lists capped, the tags come from the server (every entry of the range)
  const { tags: tagData, source } = useServerTagBreakdown(start, end);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 sm:p-6" id="tag-breakdown-report">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
            <Tag className="w-5 h-5 text-indigo-600" />
            Tag & Analytical Dimension Breakdown
          </h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Aggregated financials across multi-dimensional transaction and line item tags.
          </p>
        </div>
      </div>

      <RangeReportSourceNote source={source} testId="tag-breakdown-source" />

      {tagData.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-neutral-200 text-neutral-500 text-xs">
          No tagged transactions or line items found in the selected period.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Totals by tag</caption>
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-3 px-4">Tag</th>
                <th scope="col" className="py-3 px-4 text-center">Tagged Items</th>
                <th scope="col" className="py-3 px-4 text-right">Revenue Inflow</th>
                <th scope="col" className="py-3 px-4 text-right">Expense Outflow</th>
                <th scope="col" className="py-3 px-4 text-right">Net Financial Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {tagData.map((item) => (
                <tr key={item.tag} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="py-3 px-4 font-semibold text-neutral-900">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md">
                      <Hash className="w-3 h-3 text-indigo-500" />
                      {item.tag}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-neutral-600">
                    {item.count}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-emerald-600 font-medium">
                    {formatCurrency(item.incomeCents)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-rose-600 font-medium">
                    {formatCurrency(item.expenseCents)}
                  </td>
                  <td className={`py-3 px-4 text-right font-mono font-bold ${item.netCents >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatCurrency(item.netCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TagBreakdownReportView;
