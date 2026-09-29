"use client";

import { ResponsiveBar } from "@nivo/bar";
import { useEffect, useState } from "react";

export interface BarRow {
  id: string;
  label: string;
  value: number;
  color: string;
  /** Text at the bar tip and in the tooltip; defaults to the value. */
  display?: string;
}

const ROW = 30; // px per bar band; bars are capped at ~20px thick

/** SVG attributes don't resolve CSS variables reliably, so read the design tokens at runtime. */
function useTokenResolver(): (v: string) => string {
  const [style, setStyle] = useState<CSSStyleDeclaration | null>(null);
  useEffect(() => setStyle(getComputedStyle(document.documentElement)), []);
  return (v) => {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m?.[1] || !style) return m ? "#8B919C" : v;
    return style.getPropertyValue(m[1]).trim() || v;
  };
}

function makeTheme(t: (v: string) => string) {
  return {
    text: { fontFamily: "inherit", fontSize: 12, fill: t("var(--ink-2)") },
    axis: { ticks: { text: { fontSize: 12.5, fill: t("var(--ink)") }, line: { stroke: "transparent" } }, domain: { line: { stroke: "transparent" } } },
    grid: { line: { stroke: t("var(--line)"), strokeWidth: 1 } },
    labels: { text: { fontSize: 12, fontWeight: 600, fill: t("var(--ink)") } },
  };
}

/**
 * Horizontal single-series bar chart (nivo). One series, so no legend: the
 * panel title names the measure and every bar is labeled on the axis.
 * A table view of the same rows is always available below the chart.
 */
export function BarChart({ rows, caption, valueHeader = "Deals", leftWidth = 150 }: { rows: BarRow[]; caption: string; valueHeader?: string; leftWidth?: number }) {
  const t = useTokenResolver();
  const height = Math.max(ROW * rows.length + 8, 60);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const data = [...rows].reverse().map((r) => ({ id: r.id, label: r.label, value: r.value, color: t(r.color), display: r.display ?? String(r.value) }));

  return (
    <div>
      <div style={{ height }} role="img" aria-label={caption}>
        <ResponsiveBar
          data={data}
          keys={["value"]}
          indexBy="id"
          layout="horizontal"
          margin={{ top: 4, right: 104, bottom: 4, left: leftWidth }}
          padding={0.34}
          valueScale={{ type: "linear", min: 0, max }}
          colors={({ data: d }) => String(d.color)}
          borderRadius={4}
          enableGridX
          enableGridY={false}
          gridXValues={4}
          axisBottom={null}
          axisLeft={{ tickSize: 0, tickPadding: 10, format: (id) => data.find((d) => d.id === id)?.label ?? String(id) }}
          enableLabel
          label={(d) => String(d.data.display)}
          labelPosition="end"
          labelOffset={8}
          labelSkipWidth={0}
          theme={makeTheme(t)}
          animate={false}
          tooltip={({ data: d }) => (
            <div className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-sh2">
              <b className="font-semibold">{d.label}</b>
              <div className="text-ink-2">{d.display}</div>
            </div>
          )}
        />
      </div>
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-ink-3">Show as table</summary>
        <table className="mt-2 w-full border-collapse text-[13px]">
          <thead><tr><th className="border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2">Stage or reason</th><th className="border-b border-line px-2 py-[7px] text-left text-xs font-semibold text-ink-2">{valueHeader}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="border-b border-line p-2">{r.label}</td><td className="border-b border-line p-2 tabular-nums">{r.display ?? r.value}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
