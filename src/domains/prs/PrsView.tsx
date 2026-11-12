import { useState } from "react";
import { usePrRows } from "./hooks/usePrRows";
import { bucketOf, PrListRow, type PrTab } from "./PrListRow";
import type { PrRow } from "./prRows";

const TABS: PrTab[] = ["open", "draft", "merged", "closed"];
const TAB_LABEL: Record<PrTab, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

// Every pull request trace knows, by state: those your sessions and ticket workspaces
// raised, and those Jira's dev panel links to the loaded board's tickets, each once
// (`usePrRows`). Always on the rail: it needs no tracker.
export function PrsView() {
  const rows = usePrRows();
  const [tab, setTab] = useState<PrTab>("open");

  const buckets: Record<PrTab, PrRow[]> = { open: [], draft: [], merged: [], closed: [] };
  for (const row of rows) buckets[bucketOf(row.state)].push(row);
  const list = buckets[tab];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pull requests</h1>
          <div className="desc">
            Pull requests your sessions and tickets raised, and those Jira links to this board.
          </div>
        </div>
      </div>
      <div className="detail-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`detail-tab${t === tab ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
            <span className="count">{buckets[t].length}</span>
          </button>
        ))}
      </div>
      <div className="page-body">
        <div className="pr-list">
          <div className="pr-row-head">
            <span />
            <span>PR</span>
            <span>Title</span>
            <span>Branch</span>
            <span>Who</span>
            <span className="col-state">State</span>
          </div>
          {list.length === 0 ? (
            <div className="pr-empty">
              No {TAB_LABEL[tab].toLowerCase()} pull requests. A pull request a session or ticket
              raises shows here, as do ones Jira links to this board's tickets.
            </div>
          ) : (
            list.map((row) => <PrListRow key={row.url} row={row} />)
          )}
        </div>
      </div>
    </div>
  );
}
