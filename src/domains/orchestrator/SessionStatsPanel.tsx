import { Flags, Section, Stat } from "./StatBits";
import { agoLabel, compactCount, type SessionStats as Stats } from "./sessionStats";

interface SessionStatsPanelProps {
  stats: Stats;
  /** Epoch ms, for the activity ages. */
  now: number;
  /** A board is shown above, so these headings say "Session …". */
  withBoard: boolean;
}

// The sessions overview: standalone sessions and their agents, from
// sessionStats.ts. The whole panel when no board is connected; below the
// board's numbers when one is.
export function SessionStatsPanel({ stats, now, withBoard }: SessionStatsPanelProps) {
  const title = (t: string) => (withBoard ? `Session ${t.toLowerCase()}` : t);
  if (stats.total === 0) {
    return (
      <Section title={withBoard ? "Sessions" : "No board connected"}>
        <div className="orch-note">
          No active sessions{stats.archived ? ` (${stats.archived} archived)` : ""}. Start one on
          the Sessions page and its agents show up here.
        </div>
      </Section>
    );
  }
  const { agents, prs, chat, last7d } = stats;
  return (
    <>
      {withBoard ? (
        <div className="orch-divider">Sessions</div>
      ) : (
        <div className="orch-scope">
          No board connected — showing <span className="who">your sessions</span>
        </div>
      )}

      <Flags flags={stats.flags} />

      <Section title={title("Agents")}>
        <div className="stat-row">
          <Stat label="Working" value={agents.working} accent="working" />
          <Stat label="Needs you" value={agents.needsYou} accent="needs" />
          <Stat label="Ready" value={agents.ready} accent="ready" />
          <Stat label="Stopped" value={agents.stopped} />
        </div>
      </Section>

      <Section title={withBoard ? "Sessions by repo" : "Sessions"}>
        <div className="stat-row">
          <Stat label="Active" value={stats.total} />
          <Stat label="Agents" value={agents.total} />
          <Stat label="Archived" value={stats.archived} />
        </div>
        <div className="orch-cols orch-cols-gap">
          {stats.repos.map((r) => (
            <div key={r.name} className="orch-col-row">
              <span className="name">{r.name}</span>
              <span className="count">{r.sessions}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={title("Pull requests")}>
        <div className="stat-row">
          <Stat label="Open" value={prs.open} accent="review" />
          <Stat label="Draft" value={prs.draft} />
          <Stat label="Merged" value={prs.merged} accent="done" />
          <Stat label="Closed" value={prs.closed} />
        </div>
        {stats.prsUnchecked > 0 && (
          <div className="orch-note">
            Checking {stats.prsUnchecked} session{stats.prsUnchecked === 1 ? "" : "s"} for a PR…
          </div>
        )}
      </Section>

      <Section title="Chat agents">
        {chat.turns === 0 ? (
          <div className="orch-note">No chat-agent turns yet.</div>
        ) : (
          <div className="stat-row">
            <Stat label="Turns" value={chat.turns} />
            <Stat label="Input" value={compactCount(chat.inputTokens)} />
            <Stat label="Output" value={compactCount(chat.outputTokens)} />
            <Stat
              label="Cost"
              value={chat.costUsd === null ? "—" : `$${chat.costUsd.toFixed(2)}`}
            />
          </div>
        )}
      </Section>

      <Section title={title("Last 7 days")}>
        <div className="stat-row">
          <Stat label="Created" value={last7d.created} />
          <Stat label="Turns ended" value={last7d.turnsEnded} />
          <Stat label="Asked for input" value={last7d.askedForInput} />
        </div>
      </Section>

      {stats.recent.length > 0 && (
        <Section title={title("Recent activity")}>
          <div className="orch-cols">
            {stats.recent.map((e) => (
              <div key={e.id} className="orch-col-row">
                <span className="name">
                  {e.subject ? <span className="orch-subject">{e.subject}</span> : null}
                  {e.title}
                </span>
                <span className="count">{agoLabel(e.at, now)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
