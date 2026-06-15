import type { CSSProperties } from "react";
import { type ChartModel, chartFromSpec } from "./chartData";

// Inline charts for the chat. Pure CSS (conic-gradient ring, div bars) — no
// charting lib — using design tokens so they match the app. The data is
// deterministic (chartData.ts); these only draw it.

/** Parse a ```chart spec block and render it (or a small error note). */
export function ChartBlock({ raw }: { raw: string }) {
  let spec: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    spec = parsed as Record<string, unknown>;
  } catch {
    return <div className="chart-err">Couldn't read that chart.</div>;
  }
  const model = chartFromSpec(spec);
  if ("error" in model) return <div className="chart-err">{model.error}</div>;
  return <Chart model={model} />;
}

function Chart({ model }: { model: ChartModel }) {
  if (model.type === "donut") return <Donut model={model} />;
  return model.orientation === "h" ? <HBars model={model} /> : <VBars model={model} />;
}

function Donut({ model }: { model: Extract<ChartModel, { type: "donut" }> }) {
  const pct = model.total > 0 ? Math.round((model.value / model.total) * 100) : 0;
  return (
    <figure className="chart">
      <figcaption className="chart-title">{model.title}</figcaption>
      <div className="chart-donut-wrap">
        <div className="chart-donut" style={{ "--pct": pct } as CSSProperties}>
          <div className="chart-donut-hole">{model.center}</div>
        </div>
        <div className="chart-donut-legend">
          {model.value} of {model.total} done
        </div>
      </div>
    </figure>
  );
}

function HBars({ model }: { model: Extract<ChartModel, { type: "bars" }> }) {
  const max = Math.max(1, ...model.bars.map((b) => b.value));
  return (
    <figure className="chart">
      <figcaption className="chart-title">{model.title}</figcaption>
      <div className="chart-hbars">
        {model.bars.map((b, i) => (
          <div key={`${b.label}-${i}`} className="chart-hbar">
            <span className="chart-hbar-label" title={b.label}>
              {b.label}
            </span>
            <span className="chart-hbar-track">
              <span
                className="chart-hbar-fill"
                style={{ width: `${(b.value / max) * 100}%`, background: b.color }}
              />
            </span>
            <span className="chart-hbar-val">{b.value}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function VBars({ model }: { model: Extract<ChartModel, { type: "bars" }> }) {
  const max = Math.max(1, ...model.bars.map((b) => b.value));
  return (
    <figure className="chart">
      <figcaption className="chart-title">{model.title}</figcaption>
      <div className="chart-vbars">
        {model.bars.map((b, i) => (
          <div key={`${b.label}-${i}`} className="chart-vbar">
            <span className="chart-vbar-val">{b.value}</span>
            <span className="chart-vbar-track">
              <span
                className="chart-vbar-fill"
                style={{ height: `${(b.value / max) * 100}%`, background: b.color }}
              />
            </span>
            <span className="chart-vbar-label">{b.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
