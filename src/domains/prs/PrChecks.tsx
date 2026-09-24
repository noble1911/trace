import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { I } from "@/components/Icon";
import { formatDuration } from "@/domains/schedules/describe";
import { useNow } from "@/hooks/useNow";
import type { PrCheck } from "@/ipc/prWatch";

const LIVE = new Set<PrCheck["state"]>(["running", "queued"]);
/** Settled but not worth a row of their own unless asked. */
const QUIET = new Set<PrCheck["state"]>(["skipped", "neutral"]);

const secs = (iso: string | null) => (iso ? Date.parse(iso) / 1000 : Number.NaN);

/** "2m 13s" — ticking while running, the final duration once done. */
function timing(c: PrCheck, now: number): string {
  const start = secs(c.startedAt);
  if (Number.isNaN(start)) return "";
  if (c.state === "running") return formatDuration(now - start);
  const end = secs(c.completedAt);
  return Number.isNaN(end) ? "" : formatDuration(end - start);
}

function StateIcon({ state }: { state: PrCheck["state"] }) {
  switch (state) {
    case "running":
      return <span className="chk-spin" role="img" aria-label="Running" />;
    case "queued":
      return <I.Clock size={13} />;
    case "passed":
      return <I.Check size={13} />;
    case "failed":
      return <I.X size={13} />;
    default:
      return <span className="chk-dash" role="img" aria-label={state} />;
  }
}

// The PR's checks — Claude review, unit tests, integration shards… — each with
// its live state and time, most urgent first (the backend orders them). A
// segmented bar on top shows overall progress at a glance; skipped/neutral
// ones fold away. Rows open the check's run page.
export function PrChecks({ checks }: { checks: PrCheck[] }) {
  const [showQuiet, setShowQuiet] = useState(false);
  const anyLive = checks.some((c) => LIVE.has(c.state));
  const now = useNow(anyLive ? 1000 : null);
  if (checks.length === 0) return null;

  const counted = checks.filter((c) => !QUIET.has(c.state));
  const count = (st: PrCheck["state"]) => counted.filter((c) => c.state === st).length;
  const passed = count("passed");
  const failed = count("failed") + count("cancelled");
  const live = count("running") + count("queued");
  const quiet = checks.length - counted.length;
  const rows = showQuiet ? checks : counted;
  const pct = (n: number) => `${(n / Math.max(1, counted.length)) * 100}%`;

  return (
    <div className="pr-checks">
      <div className="pr-checks-head">
        <span className="label">Checks</span>
        <span className="pr-checks-sum">
          {passed}/{counted.length} passed
          {failed > 0 && <b className="fail"> · {failed} failed</b>}
          {live > 0 && <b className="live"> · {live} running</b>}
        </span>
      </div>
      <div className="chk-bar" role="img" aria-label={`${passed} of ${counted.length} passed`}>
        <span className="passed" style={{ width: pct(passed) }} />
        <span className="failed" style={{ width: pct(failed) }} />
        <span className="live" style={{ width: pct(live) }} />
      </div>
      <div className="chk-list">
        {rows.map((c) => (
          <button
            type="button"
            key={`${c.workflow ?? ""}/${c.name}`}
            className={`chk-row ${c.state}`}
            onClick={() => c.url && void openUrl(c.url)}
            disabled={!c.url}
            title={c.url ? "Open this check's run" : undefined}
          >
            <span className="chk-ic">
              <StateIcon state={c.state} />
            </span>
            <span className="chk-name">
              {c.name}
              {(c.workflow || c.detail) && (
                <span className="chk-sub">{c.detail ?? c.workflow}</span>
              )}
            </span>
            <span className="chk-time">{c.state === "queued" ? "queued" : timing(c, now)}</span>
          </button>
        ))}
      </div>
      {quiet > 0 && (
        <button type="button" className="pr-link-btn" onClick={() => setShowQuiet(!showQuiet)}>
          {showQuiet ? "Hide skipped" : `${quiet} skipped`}
        </button>
      )}
    </div>
  );
}
