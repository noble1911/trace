import { useEffect, useState } from "react";
import { Switch } from "@/components/Switch";
import {
  type CleanupReport,
  type CleanupScope,
  type CleanupSettings,
  getCleanupSettings,
  previewCleanup,
  runCleanupNow,
  setCleanupSettings,
} from "@/ipc/cleanup";
import { CleanupPreview } from "./CleanupPreview";
import { SettingRow } from "./SettingRow";

const UNIT_HOURS = { hours: 1, days: 24, weeks: 168 } as const;
type Unit = keyof typeof UNIT_HOURS;

/** Show a stored hour count in the largest unit that divides it evenly. */
function splitHours(hours: number): { amount: string; unit: Unit } {
  const unit: Unit = hours % 168 === 0 ? "weeks" : hours % 24 === 0 ? "days" : "hours";
  return { amount: String(hours / UNIT_HOURS[unit]), unit };
}

interface AutoCleanupSettingsProps {
  /** A manual pass removed worktrees — the list below should rescan. */
  onCleaned: () => void;
}

// Settings → Worktrees: delete idle workspaces' checkouts automatically. Off by
// default; the rules are saved backend-side, where the hourly pass reads them.
export function AutoCleanupSettings({ onCleaned }: AutoCleanupSettingsProps) {
  const [settings, setSettings] = useState<CleanupSettings | null>(null);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<Unit>("days");
  const [report, setReport] = useState<CleanupReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCleanupSettings()
      .then((s) => {
        setSettings(s);
        const split = splitHours(s.afterHours);
        setAmount(split.amount);
        setUnit(split.unit);
      })
      .catch((err) => setError(String(err)));
  }, []);

  // Re-preview after each saved change. Debounced: it runs git in every
  // worktree and may ask the tracker about each ticket.
  useEffect(() => {
    if (!settings?.enabled) return;
    let cancelled = false;
    setReport(null);
    const timer = setTimeout(() => {
      void previewCleanup()
        .then((r) => !cancelled && setReport(r))
        .catch((err) => !cancelled && setError(String(err)));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [settings]);

  if (!settings) {
    return error ? <div className="setting-note error">{error}</div> : null;
  }

  // Save first, then adopt what was stored — the preview reads the saved rules.
  const update = (patch: Partial<CleanupSettings>) => {
    setError(null);
    setNote(null);
    void setCleanupSettings({ ...settings, ...patch })
      .then(setSettings)
      .catch((err) => setError(String(err)));
  };

  const changePeriod = (nextAmount: string, nextUnit: Unit) => {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const n = Number.parseInt(nextAmount, 10);
    if (Number.isFinite(n) && n >= 1) update({ afterHours: n * UNIT_HOURS[nextUnit] });
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await runCleanupNow();
      const removed = done.items.filter((it) => !it.held).length;
      setNote(`Deleted ${removed} workspace${removed === 1 ? "" : "s"}.`);
      onCleaned();
      setReport(await previewCleanup());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="setting-group">
      <h2>Auto-cleanup</h2>
      <div className="desc">
        Delete the checkouts of workspaces nobody has touched in a while. The session or ticket
        stays: starting it again makes a fresh checkout and resumes the conversation.
      </div>
      <SettingRow label="Delete idle workspaces" hint="Checked hourly while trace is open.">
        <Switch
          on={settings.enabled}
          onChange={(enabled) => update({ enabled })}
          label="Delete idle workspaces automatically"
        />
      </SettingRow>
      {settings.enabled && (
        <>
          <SettingRow
            label="After"
            hint="Idle since its last activity: the agent's last message, a commit, or archiving."
          >
            <div className="cleanup-period">
              <input
                type="number"
                min={1}
                aria-label="Idle period"
                value={amount}
                onChange={(e) => changePeriod(e.target.value, unit)}
              />
              <select
                aria-label="Idle period unit"
                value={unit}
                onChange={(e) => changePeriod(amount, e.target.value as Unit)}
              >
                <option value="hours">hours</option>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </select>
            </div>
          </SettingRow>
          <SettingRow label="Applies to" hint="Exploratory sessions, ticket workspaces, or both.">
            <select
              aria-label="Applies to"
              value={settings.scope}
              onChange={(e) => update({ scope: e.target.value as CleanupScope })}
            >
              <option value="both">Sessions and tickets</option>
              <option value="sessions">Sessions only</option>
              <option value="tickets">Tickets only</option>
            </select>
          </SettingRow>
          {settings.scope !== "tickets" && (
            <SettingRow
              label="Only archived sessions"
              hint="Leave active sessions alone; delete only ones in the recycle bin."
            >
              <Switch
                on={settings.sessionsOnlyArchived}
                onChange={(sessionsOnlyArchived) => update({ sessionsOnlyArchived })}
                label="Only delete archived sessions"
              />
            </SettingRow>
          )}
          {settings.scope !== "sessions" && (
            <SettingRow
              label="Only tickets in Done"
              hint="Delete a ticket's workspace only once its issue is in a Done status."
            >
              <Switch
                on={settings.ticketsOnlyDone}
                onChange={(ticketsOnlyDone) => update({ ticketsOnlyDone })}
                label="Only delete tickets in Done"
              />
            </SettingRow>
          )}
          <div className="setting-block">
            <div className="hint">
              Never deleted: workspaces with uncommitted changes or a running agent. A branch with
              unpushed commits is kept, so starting the workspace again checks it back out.
            </div>
            <CleanupPreview report={report} busy={busy} onRun={() => void runNow()} />
          </div>
        </>
      )}
      {note && <div className="setting-note">{note}</div>}
      {error && <div className="setting-note error">{error}</div>}
    </section>
  );
}
