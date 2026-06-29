import { useEffect, useRef, useState } from "react";
import { type HtmlBlock, useRichOutputStore } from "./richOutputStore";

// Stable empty-array reference for issues with no cards yet. A fresh `[]` from the
// selector on every render is never Object.is-equal to the last, so Zustand's
// useSyncExternalStore would treat the store as changed every render and loop
// ("Maximum update depth exceeded"). Mirrors EMPTY_PRS in AgentDetail.
const NO_BLOCKS: HtmlBlock[] = [];

/** Best-effort label for a card: the document's <title>, else "Diagram N". */
function labelOf(html: string, index: number): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = m?.[1]?.trim();
  return title && title.length > 0 ? title : `Diagram ${index + 1}`;
}

// The "HTML" tab. The Claude TUI repaints its grid in place, so HTML can't live
// *inside* the terminal — the agent emits it out-of-band (trace-render → render
// bridge, or an OSC 7700 marker) and it renders here. One card shows at a time,
// filling the pane, in a sandboxed <iframe>: a full standalone document (with its
// own <style>) renders at fidelity while the sandbox keeps scripts inert and walls
// it off from trace's DOM. Cards persist across stop/start and reloads.
export function RichOutputPanel({ issueKey }: { issueKey: string }) {
  const blocks = useRichOutputStore((s) => s.blocks[issueKey] ?? NO_BLOCKS);
  const clear = useRichOutputStore((s) => s.clear);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Auto-follow the newest card as it arrives; a manual switch sticks until the
  // next new card. Tracked by id (not index) so selection survives list growth.
  const newestId = blocks.length > 0 ? blocks[blocks.length - 1].id : null;
  const newestRef = useRef(newestId);
  useEffect(() => {
    if (newestId !== newestRef.current) {
      newestRef.current = newestId;
      setSelectedId(newestId);
    }
  }, [newestId]);

  if (blocks.length === 0) {
    return (
      <div className="rich-output-pane">
        <div className="rich-output-empty">
          <div className="rich-output-empty-title">No rendered HTML yet</div>
          <div className="rich-output-empty-hint">
            Your agent can render a document here by running{" "}
            <code>trace-render &lt;file.html&gt;</code> (or piping HTML into{" "}
            <code>trace-render</code>).
          </div>
        </div>
      </div>
    );
  }

  // Show the selected card if it still exists, else the most recent.
  const active = blocks.find((b) => b.id === selectedId) ?? blocks[blocks.length - 1];

  return (
    <div className="rich-output-pane">
      <div className="rich-output-head">
        <div className="rich-output-tabs">
          {blocks.map((b, i) => (
            <button
              key={b.id}
              type="button"
              className={`rich-output-tab${b.id === active.id ? " active" : ""}`}
              onClick={() => setSelectedId(b.id)}
              title={labelOf(b.html, i)}
            >
              {labelOf(b.html, i)}
            </button>
          ))}
        </div>
        <button type="button" className="rich-output-clear" onClick={() => clear(issueKey)}>
          Clear
        </button>
      </div>
      {/* sandbox="" is the most restrictive setting: scripts disabled, opaque
          origin, no form submission or popups. Untrusted agent HTML renders its
          markup + CSS but cannot execute JS or reach the parent app. key forces a
          clean frame reload when switching cards. */}
      <iframe
        key={active.id}
        className="rich-output-frame"
        sandbox=""
        srcDoc={active.html}
        title={labelOf(active.html, blocks.indexOf(active))}
      />
    </div>
  );
}
