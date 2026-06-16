import { useMemo, useState } from "react";
import { VegaEmbed } from "react-vega";
import type { VisualizationSpec } from "vega-embed";

// Renders a freeform Vega-Lite spec the assistant built from data it has or
// fetched (e.g. via MCP) — the open-ended counterpart to the deterministic
// board charts. Themed from the app's design tokens so it matches the UI, sized
// to the chat panel, and it degrades to a note rather than crashing the chat.

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** A dark Vega config from the design tokens (read at render, never hardcoded). */
function themeConfig(): Record<string, unknown> {
  const fg0 = token("--fg-0");
  const fg2 = token("--fg-2");
  const fg3 = token("--fg-3");
  const fg4 = token("--fg-4");
  const border = token("--border");
  const borderFaint = token("--border-faint");
  const category = ["--c-prog", "--c-review", "--c-done", "--c-accent", "--c-todo"].map(token);
  return {
    background: "transparent",
    title: { color: fg0, fontSize: 12, fontWeight: 600, anchor: "start" },
    axis: {
      labelColor: fg3,
      titleColor: fg4,
      gridColor: borderFaint,
      domainColor: border,
      tickColor: border,
      labelFontSize: 10,
      titleFontSize: 10,
    },
    legend: { labelColor: fg2, titleColor: fg4, labelFontSize: 10, titleFontSize: 10 },
    view: { stroke: "transparent" },
    range: { category },
    mark: { color: token("--c-prog") },
  };
}

export function VegaChart({ spec }: { spec: Record<string, unknown> }) {
  const [failed, setFailed] = useState(false);

  // Force a container-fit width (the model doesn't know the panel size) and our
  // theme as the base config, while letting the spec's own config override.
  const full = useMemo<VisualizationSpec>(() => {
    const userConfig = spec.config && typeof spec.config === "object" ? spec.config : {};
    // The spec is dynamic (AI-supplied), so cross into Vega's type via unknown.
    return {
      ...spec,
      width: "container",
      autosize: { type: "fit", contains: "padding" },
      config: { ...themeConfig(), ...userConfig },
    } as unknown as VisualizationSpec;
  }, [spec]);

  if (failed) return <div className="chart-err">Couldn't render that chart.</div>;
  return (
    <VegaEmbed
      className="vega-chart"
      spec={full}
      options={{ renderer: "svg", actions: false }}
      onError={() => setFailed(true)}
    />
  );
}
