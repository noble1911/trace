import { columnColor } from "@/domains/board/columns";
import { scopedStatsInput } from "./context";
import { computeBoardStats } from "./stats";

// Deterministic chart data. The assistant only ever picks a chart KIND (and a
// range); every value here comes from the same scoped board input the text
// snapshot uses — so a chart can never disagree with the numbers, and the model
// can't fabricate one. Pure data; rendering lives in Chart.tsx.

export interface ChartBar {
  label: string;
  value: number;
  color: string;
}

export type ChartModel =
  | { type: "donut"; title: string; value: number; total: number; center: string }
  | { type: "bars"; title: string; orientation: "h" | "v"; bars: ChartBar[] };

export type ChartResult = ChartModel | { error: string };

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function readNumber(spec: Record<string, unknown>, key: string, fallback: number): number {
  const v = spec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Turn a `{kind, ...}` spec into a renderable chart model, or an error note. */
export function chartFromSpec(spec: Record<string, unknown>): ChartResult {
  const input = scopedStatsInput();
  if (!input?.board) return { error: "No board is loaded." };
  const kind = typeof spec.kind === "string" ? spec.kind : "";
  const stats = computeBoardStats(input);

  if (kind === "progress") {
    return {
      type: "donut",
      title: "Sprint progress",
      value: stats.done,
      total: stats.total,
      center: `${stats.pctDone}%`,
    };
  }

  if (kind === "columns") {
    const n = stats.columns.length;
    return {
      type: "bars",
      title: "Tickets by column",
      orientation: "h",
      bars: stats.columns.map((c, i) => ({
        label: c.name,
        value: c.count,
        color: columnColor(i, n),
      })),
    };
  }

  if (kind === "assignees") {
    const counts = new Map<string, number>();
    for (const issue of input.board.issues) {
      const name = issue.assignee?.displayName ?? "Unassigned";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const bars = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, value]) => ({ label, value, color: "var(--c-accent)" }));
    return { type: "bars", title: "Tickets by assignee", orientation: "h", bars };
  }

  if (kind === "throughput") {
    const days = Math.min(30, Math.max(3, Math.round(readNumber(spec, "days", 7))));
    const start = startOfDay(input.now) - (days - 1) * DAY;
    const buckets = new Array<number>(days).fill(0);
    for (const e of input.activity) {
      if (e.kind !== "pr-merged") continue;
      const idx = Math.floor((startOfDay(e.at) - start) / DAY);
      if (idx >= 0 && idx < days) buckets[idx] += 1;
    }
    const bars = buckets.map((value, i) => ({
      label: WEEKDAYS[new Date(start + i * DAY).getDay()] ?? "",
      value,
      color: "var(--c-done)",
    }));
    return { type: "bars", title: `PRs merged · last ${days} days`, orientation: "v", bars };
  }

  return { error: `Unknown chart "${kind}". Try: progress, columns, assignees, throughput.` };
}
