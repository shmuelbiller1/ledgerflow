import React, { useState } from "react";
import { useChartKind, useChartScope } from "../../hooks/useChartKind";
import ChartKindPicker from "../charts/ChartKindPicker";
import { ChartTooltip } from "../charts/ChartFrame";

interface Props {
  chartId: string;
  label: string;
  rows: { label: string; cents: number }[];
  currency?: string;
}
export default function DashboardTrendChart(props: Props) {
  const scope = useChartScope(props.chartId);
  return <ScopedTrend key={scope} {...props} preferenceKey={scope} />;
}
function ScopedTrend({
  rows,
  label,
  currency,
  preferenceKey,
}: Props & { preferenceKey: string }) {
  const { kind, changeKind, storageError } = useChartKind(
    preferenceKey,
    "line",
  );
  const [hidden, setHidden] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const selectedRow = rows.find((row) => row.label === (hovered || selected));
  const min = Math.min(0, ...rows.map((row) => row.cents)),
    max = Math.max(0, ...rows.map((row) => row.cents)),
    span = max - min;
  const y = (value: number) => (span ? 30 - ((value - min) * 28) / span : 16);
  const x = (index: number) =>
    rows.length > 1 ? 4 + (index * 92) / (rows.length - 1) : 50;
  const points = rows
    .map((row, index) => `${x(index)},${y(row.cents)}`)
    .join(" ");
  return (
    <div className="space-y-2 mt-3">
      <ChartKindPicker title={label} kind={kind} onChange={changeKind} />
      <button
        type="button"
        aria-label={`${label} trend`}
        aria-pressed={!hidden}
        onClick={() => {
          setHidden(!hidden);
          setSelected(null);
          setHovered(null);
        }}
        className="option-state min-h-11 px-3 border border-[var(--line)] rounded-lg"
      >
        {label}
      </button>
      {storageError && (
        <p role="status">
          Chart style changed for this visit; this browser could not save it.
        </p>
      )}
      {hidden ? (
        <p role="status">Trend hidden. Show the series to draw it.</p>
      ) : (
        <>
          <svg
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            role="img"
            aria-label={`${label}, last 12 months; values available below`}
            className="w-full h-12 text-[var(--brass)]"
            onPointerMove={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (!bounds.width || !rows.length) return;
              const index = Math.max(
                0,
                Math.min(
                  rows.length - 1,
                  Math.round(
                    ((((event.clientX - bounds.left) / bounds.width) * 100 -
                      4) /
                      92) *
                      (rows.length - 1),
                  ),
                ),
              );
              setHovered(rows[index].label);
            }}
            onPointerLeave={() => setHovered(null)}
          >
            {kind === "bar" ? (
              rows.map((row, index) => (
                <rect
                  key={row.label}
                  x={x(index) - 2}
                  y={Math.min(y(row.cents), y(0))}
                  width={4}
                  height={Math.abs(y(row.cents) - y(0))}
                  fill="currentColor"
                />
              ))
            ) : (
              <>
                {kind === "area" && (
                  <polygon
                    points={`${x(0)},${y(0)} ${points} ${x(rows.length - 1)},${y(0)}`}
                    fill="currentColor"
                    fillOpacity={0.15}
                  />
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </>
            )}
          </svg>
          <label className="block text-sm">
            Inspect month
            <select
              aria-label={`${label} chart month`}
              className="block w-full min-h-11 px-2 border border-[var(--line)] bg-[var(--panel)] rounded-lg"
              value={
                rows.some((row) => row.label === selected) ? selected || "" : ""
              }
              onChange={(event) => setSelected(event.target.value || null)}
            >
              <option value="">Choose a month</option>
              {rows.map((row) => (
                <option key={row.label} value={row.label}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
          <ChartTooltip
            active={!!selectedRow}
            label={selectedRow?.label}
            currency={currency}
            payload={
              selectedRow
                ? [{ dataKey: "cents", name: label, value: selectedRow.cents }]
                : []
            }
          />
        </>
      )}
    </div>
  );
}
